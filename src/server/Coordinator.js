// src/server/Coordinator.js
'use strict';

const cluster = require('node:cluster');
const os = require('node:os');
const Redis = require('ioredis');
const { Logger } = require('../core/Logger');
const { setConfig } = require('../core/Config');
const Outage = require('../core/infra/OutageDeduper');
/** Zero-based worker index. */
function getWorkerIndex() {
    if (process.env.WORKER_INDEX != null) return Number(process.env.WORKER_INDEX);
    if (cluster.isWorker && typeof cluster.worker?.id === 'number') return cluster.worker.id - 1;
    return 0;
}

// Publish a primary-only event via Redis (if configured)
function _primaryPublish(cfg, channel, payload = {}) {
    if (!cfg?.redis) return;

    const origin = (cfg?.zapi?.serverName) || 'zapiAppServer';
    const envelope = {
        event: channel,
        eventHeader: { origin, ts: Date.now(), state: { status: 'Ok', meta: { role: 'primary', workerIndex: -1, pid: process.pid } } },
        eventPayload: payload
    };

    const baseOpts = { retryStrategy: (t)=>Math.min(t*10000,60000), maxRetriesPerRequest: null, lazyConnect: true };
    const url = cfg.redis.url;
    const client = url ? new Redis(url, baseOpts) : new Redis({ host: cfg.redis.host, port: cfg.redis.port, password: cfg.redis.password, db: cfg.redis.db, ...baseOpts });

    client.on('error', () => { Outage.down('redis:primary'); /* quiet */ });
    client.on('ready', () => { Outage.up('redis:primary'); });

    client.publish(channel, JSON.stringify(envelope)).finally(() => { try { client.quit(); } catch {} });
}

class Coordinator {
    constructor(config) {
        this.config = config || {};
        this.log = new Logger('Coordinator', this.config.logLevel || 'info');
    }

    async init() {
        setConfig(this.config);
    }

    async start() {
        const wantsCluster = !!(this.config.coordinator && this.config.coordinator.enable);
        const hasExpress  = !!(this.config.express && this.config.express.enable);

        if (!wantsCluster || !hasExpress) {
            this.log.warn('Cluster disabled or express disabled — running a single worker inline');
            const { runWorkerInline } = require('./WorkerServer');
            await runWorkerInline();
            return;
        }

        if (cluster.isPrimary) {
            process.env.ZAPI_PRIMARY = '1'; // mark this process as primary for envelopes
            const cpuCount = os.cpus().length;
            const desired = Math.max(1, Math.min((this.config.express.workers || 1), cpuCount));
            this.log.info(`Primary PID ${process.pid} forking ${desired} workers…`);

            _primaryPublish(this.config, 'zapi:sys:primary:ready', { workers: desired });

            for (let i = 0; i < desired; i++) this._forkWorker(i);

            cluster.on('exit', (worker, code, signal) => {
                this.log.warn(`Worker ${worker?.process?.pid} exited (code=${code}, signal=${signal}). Restarting…`);
                _primaryPublish(this.config, 'zapi:sys:primary:worker:exit', { pid: worker?.process?.pid, code, signal });
                this._forkWorker(Object.keys(cluster.workers).length); // simple next-index policy
            });

            this.log.info(`Cluster setup complete. Primary PID ${process.pid} is running.`);
            this.log.info(`Listening on port ${this.config.express.port} with ${desired} workers at http://localhost:${this.config.express.port}/`);
        } else {
            const { runWorkerInline } = require('./WorkerServer');
            await runWorkerInline();
        }
    }

    async stop() {
        if (cluster.isPrimary && this.config.coordinator?.enable) {
            _primaryPublish(this.config, 'zapi:sys:primary:stopping', { pid: process.pid });
            const workers = cluster.workers || {};
            for (const id in workers) { try { workers[id]?.kill('SIGINT'); } catch {} }
        }
    }

    _forkWorker(i) {
        const env = { ...process.env };
        if (i !== undefined) env.WORKER_INDEX = i;
        const w = cluster.fork(env);
        this._wireWorker(w);
    }

    _wireWorker(w) {
        // push latest config on spawn
        try { w.send({ type: 'config:push', payload: this.config }); } catch {}

        w.on('message', (m) => {
            if (!m || typeof m !== 'object') return;

            // Fan-in from any worker: heartbeat via IPC
            if (m.type === 'sys:heartbeat' && m.payload) {
                // Forward to all workers; only the leader worker consumes it.
                const workers = require('node:cluster').workers || {};
                for (const id in workers) {
                    try { workers[id]?.send({ type: 'sys:heartbeat', payload: m.payload }); } catch {}
                }
                return; // handled
            }

            // existing worker lifecycle logs
            if (m.type === 'worker:online')  this.log.info(`Worker ${m.pid} online`);
            if (m.type === 'worker:error')   this.log.error(`Worker ${m.pid} error:`, m.error);
            if (m.type === 'worker:stopped') this.log.warn(`Worker ${m.pid} stopped code=${m.code} signal=${m.signal}`);
        });
    }

}

module.exports = { Coordinator, getWorkerIndex };
