// src/server/JobQueueServer.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BaseLifecycle } = require('../core/BaseLifecycle');
const { resolveService, setService } = require('../core/registry/services');
const { getConfig, appDirCandidates } = require('../core/Config');
const { getWorkerIndex } = require('../core/system/workerInfo');
const { createCache } = require('../cache/RedisCache'); // resilient Redis cache; raw() → ioredis

/**
 * JobQueueServer
 * -----------------------------------------------------------------------------
 * - Auto-discovers jobs from app/jobQueueRoutes.js (array or factory)
 * - Optional leaderOnly: start only on workerIndex === 0
 * - In-memory FIFO with throttling; optional Redis list (jobq:_all) for cluster pop
 * - Broadcast completion via EventServer when enabled
 *
 * Job definition (in app/jobQueueRoutes.js):
 *   module.exports = ({ resolveService }) => ([
 *     {
 *       name: 'Email:Send',
 *       middleware: async (payload, ctx) => payload,          // optional
 *       execute:    async (payload, ctx) => {  do work  }  // required
 *     },
 *   ]);
 *
 *   - Middleware can validate/transform payload; ctx has { resolveService, jobId, jobName, eventServer }
 *   - Execute does the actual work; ctx as above
 *
 * Config (zapi.jobqueue):
 *   {
 *     "throttlecount": 100,        // start throttling if memory queue >= this (default 100)
 *     "throttletime": 1,           // seconds between jobs when throttling (default 1)
 *     "useredis": true,            // use Redis if available (default false)
 *     "jobworkerinstances": 1,     // number of concurrent workers (default 1)
 *     "broadcast": true,           // publish completion events via EventServer (if available) (default false)
 *     "leaderOnly": true           // start only on workerIndex === 0 (default false)
 *   }
 *
 * Example usage:
 *   const { resolveController } = require('@zapshark/zapi');
 *
 * // Resolve the controller (auto-registered at startup)
 * const jobQueue = resolveController('JobQueueController');
 *
 * // Enqueue a job
 * (async () => {
 *   const jobId = await jobQueue.enqueue('Demo:Sleep', { ms: 1500 });
 *   console.log('Enqueued job:', jobId);
 * })();
 */
class JobQueueServer extends BaseLifecycle {
    static artifactName = 'JobQueueServer';
    static artifactKind = 'service';

    constructor() {
        super({ name: JobQueueServer.artifactName, kind: JobQueueServer.artifactKind });
        this.jobs = new Map();
        this.queue = [];
        this.running = false;
        this._active = 0;
        this.stats = {
            totalJobs: 0,
            perRoute: new Map(),
            throttleEvents: 0,
            throttledMsTotal: 0
        };
        this._throttleActive = false;
        this._throttleStart = 0;
        this._concurrency = 1;
        this.cfg = null;
        this.cache = null;
        this.redis = null;
        this.eventServer = null;
    }


    /**
     * Initializes the job queue server.
     * - Reads config, validates options, wires dependencies, discovers jobs.
     * No parameters.
     */
    async init() {
        this.cfg = getConfig?.() || {};
        const jq = this.cfg?.zapi?.jobqueue || {};

        // Validate config options
        if (jq.useredis) {
            if (!this.cfg.redis) {
                this.log.warn('useredis=true but no redis config found; disabling Redis usage.');
                jq.useredis = false;
            }
        }
        if (jq.jobworkerinstances && (isNaN(jq.jobworkerinstances) || jq.jobworkerinstances < 1)) {
            this.log.warn('Invalid jobworkerinstances; defaulting to 1.');
            jq.jobworkerinstances = 1;
        }

        this.options = {
            throttlecount: Number(jq.throttlecount ?? 100),
            throttletime: Number(jq.throttletime ?? 1),
            useredis: !!jq.useredis,
            jobworkerinstances: Math.max(1, Number(jq.jobworkerinstances ?? 1)),
            broadcast: !!jq.broadcast,
            leaderOnly: !!jq.leaderOnly
        };
        this._concurrency = this.options.jobworkerinstances;

        try { this.eventServer = resolveService('EventServer'); } catch (e) { this.eventServer = null; this.log.warn('EventServer not available:', e); }

        if (this.options.useredis) {
            try {
                this.cache = await createCache(this.cfg);
                const raw = this.cache?.raw?.();
                this.redis = (raw && raw.status !== 'end') ? raw : null;
                if (!this.redis) this.log.warn('Redis client not available or ended; falling back to memory queue.');
            } catch (e) {
                this.cache = null;
                this.redis = null;
                this.log.warn('Failed to create Redis cache:', e);
            }
        }

        await this._discoverJobs();

        try { setService(JobQueueServer.artifactName, this); } catch (e) { this.log.warn('Failed to register service:', e); }
    }

    /**
     * Starts the job queue server.
     * - Begins job processing pumps based on concurrency.
     * No parameters.
     */
    async start() {
        const idx = getWorkerIndex();
        if (this.options.leaderOnly && idx !== 0) {
            this.log.info(`leaderOnly=true → skipping start on workerIndex=${idx}`);
            return;
        }
        this.running = true;
        for (let i = 0; i < this._concurrency; i++) this._pump();
        this.log.info(`Started (workerIndex=${idx}, concurrency=${this._concurrency}, redis=${!!this.redis})`);
    }

    /**
     * Stops the job queue server.
     * - Halts job processing and cleans up resources.
     * No parameters.
     */
    async stop() {
        this.running = false;
        if (this._throttleActive) this._throttleEnd();
        // Clean up Redis connection if used
        if (this.redis) {
            try { await this.redis.quit(); } catch (e) { this.log.warn('Error quitting Redis:', e); }
        }
    }

    // --------------------------- Public API ---------------------------

    /**
     * Registers a job definition.
     * @param {string} name - The job name.
     * @param {object} def - The job definition object with `execute` and optional `middleware`.
     */
    registerJob(name, def) {
        if (!name || !def || typeof def.execute !== 'function') throw new Error('Invalid job definition');
        if (this.jobs.has(name)) {
            this.log.warn(`Duplicate job registration for "${name}". Overwriting existing job.`);
        }
        this.jobs.set(name, { middleware: def.middleware, execute: def.execute });
        this.log.info(`Registered job "${name}"`);
    }

    /**
     * Enqueues a job for processing.
     * @param {string} name - The job name.
     * @param {any} payload - The job payload/data.
     * @returns {string} - The job ID.
     */
    enqueue(name, payload) {
        if (!this.jobs.has(name)) throw new Error(`Job "${name}" is not registered`);
        const job = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, payload, ts: Date.now() };

        if (this.redis) {
            try {
                this.redis.rpush('jobq:_all', JSON.stringify(job));
            } catch (e) {
                this.log.warn(`Redis enqueue failed for "${name}"; using memory: ${e?.message}`);
                this.queue.push(job);
                this._maybeThrottle();
            }
            return job.id;
        }

        this.queue.push(job);
        this._maybeThrottle();
        return job.id;
    }

    /**
     * Lists all registered job names.
     * No parameters.
     * @returns {Array<string>} - Array of job names.
     */
    listJobs() {
        return Array.from(this.jobs.keys());
    }


    /**
     * Returns job queue statistics.
     * No parameters.
     * @returns {object} - Stats object.
     */
    getStats() {
        const perRoute = Object.fromEntries(this.stats.perRoute.entries());
        return {
            totalJobs: this.stats.totalJobs,
            perRoute,
            throttleEvents: this.stats.throttleEvents,
            throttledMsTotal: this.stats.throttledMsTotal,
            queueLength: this.redis ? null : this.queue.length,
            concurrency: this._concurrency,
            throttleActive: this._throttleActive
        };
    }

    // -------------------------- Internals ----------------------------

    /**
     * Discovers job definitions from app directory.
     * No parameters.
     * @private
     */
    async _discoverJobs() {
        const bases = appDirCandidates(this.cfg);
        let found = null;
        for (const base of bases) {
            const p = path.join(base, 'jobQueueRoutes.js');
            try { if (fs.existsSync(p)) { found = p; break; } } catch (e) { this.log.warn('Error checking jobQueueRoutes.js:', e); }
        }

        if (!found) {
            this.log.info('No app/jobQueueRoutes.js found; running with 0 jobs.');
            return;
        }

        try {
            const mod = require(found);
            const defs =
                (typeof mod === 'function')
                    ? mod({ resolveService })
                    : (Array.isArray(mod) ? mod : (Array.isArray(mod?.default) ? mod.default : null));

            if (!Array.isArray(defs)) {
                this.log.warn(`Ignored ${path.relative(process.cwd(), found)} (not an array/factory returning array)`);
                return;
            }

            for (const j of defs) {
                if (!j?.name || typeof j.execute !== 'function') {
                    this.log.warn(`Skipped invalid job in ${path.relative(process.cwd(), found)}`);
                    continue;
                }
                this.registerJob(j.name, { middleware: j.middleware, execute: j.execute });
            }
            this.log.info(`Loaded ${defs.length} job(s) from ${path.relative(process.cwd(), found)}`);
        } catch (e) {
            this.log.warn(`Failed loading jobQueueRoutes at ${path.relative(process.cwd(), found)}: ${e?.message}`);
        }
    }


    /**
     * Checks and manages throttling state for in-memory queue.
     * No parameters.
     * @private
     */
    _maybeThrottle() {
        if (this.redis) return;
        const n = this.queue.length;
        if (!this._throttleActive && n >= this.options.throttlecount) this._throttleBegin();
        if (this._throttleActive && n < this.options.throttlecount) this._throttleEnd();
    }


    /**
     * Begins throttling (pausing job intake).
     * No parameters.
     * @private
     */
    _throttleBegin() {
        this._throttleActive = true;
        this._throttleStart = Date.now();
        this.stats.throttleEvents += 1;
        this.log.warn(`Throttle ON (queueLen=${this.queue.length})`);
    }


    /**
     * Ends throttling (resumes job intake).
     * No parameters.
     * @private
     */
    _throttleEnd() {
        this._throttleActive = false;
        const dur = Date.now() - (this._throttleStart || Date.now());
        this.stats.throttledMsTotal += dur;
        this._throttleStart = 0;
        this.log.info(`Throttle OFF (duration=${dur}ms)`);
    }


    /**
     * Main job processing loop for a worker.
     * No parameters.
     * @private
     */
    async _pump() {
        while (this.running) {
            let job = null;

            if (this.redis) {
                try {
                    const res = await this.redis.blpop('jobq:_all', 1);
                    if (res && res[1]) job = JSON.parse(res[1]);
                } catch (e) {
                    this.log.warn(`BLPOP error; continuing: ${e?.message}`);
                }
            } else {
                job = this.queue.shift();
            }

            if (!job) { await this._sleep(25); continue; }

            this._active++;
            try {
                const def = this.jobs.get(job.name);
                if (!def) throw new Error(`Unknown job "${job.name}" (deregistered?)`);
                const ctx = { resolveService, jobId: job.id, jobName: job.name, eventServer: this.eventServer };

                const payload = def.middleware ? await def.middleware(job.payload, ctx) : job.payload;
                const result  = await def.execute(payload, ctx);

                this.stats.totalJobs++;
                this.stats.perRoute.set(job.name, (this.stats.perRoute.get(job.name) || 0) + 1);

                if (this.options.broadcast && this.eventServer) {
                    try {
                        await this.eventServer.publish('zapi:jobqueue:completed', {
                            id: job.id,
                            name: job.name,
                            completedAt: Date.now()
                        });
                    } catch (e) {
                        this.log.warn('EventServer publish failed:', e);
                    }
                }

            } catch (e) {
                this.log.error(`Job "${job.name}" failed:`, e);
            } finally {
                this._active--;
            }

            if (this._throttleActive) await this._sleep(this.options.throttletime * 1000);
        }
    }

    /**
     * Utility to sleep for a given number of milliseconds.
     * @param {number} ms - Milliseconds to sleep.
     * @returns {Promise<void>}
     * @private
     */
    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = JobQueueServer;
