// src/server/WorkerServer.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cluster = require('node:cluster');
const express = require('express');

const { Logger } = require('../core/Logger');
const { getConfig, setConfig, appDirCandidates } = require('../core/Config');
const { buildRouter } = require('../http/Router');
const { startMongoConnector , disconnectMongo } = require('../db/MongooseManager');
const { createCache } = require('../cache/RedisCache');
const { startWebSocketServer } = require('../ws/WebSocketServer');
const { MessageBus } = require('../ws/MessageBus');

const { setService, resolveService } = require('../core/registry/services');
const { setController, resolveController } = require('../core/registry/controllers');
const { setMiddleware } = require('../core/registry/middleware');
const { createClusterHeartbeat } = require('../core/system/ClusterHeartbeat');
const { createMetricsIngestor } = require('../core/system/MetricsIngestor');

// 🔹 Central event + health + transports
const EventServer = require('../core/events/EventServer');
const SystemEventService = require('../core/events/SystemEventService');
const RedisEventService = require('../core/events/RedisEventService');
const WsEventService = require('../core/events/WsEventService');
const HealthService = require('../core/system/HealthService');

// 🔹 Infra status (to decide local-only bus when Redis is down)
const Infra = require('../core/infra/InfraStatus');
const mongoose = require("mongoose");

const log = new Logger('Worker');

/* ====== Helpers ====== */
function resolveInDirs(dirs, baseNameNoExt) {
    const exts = ['.js', '.cjs', '.mjs'];
    for (const dir of dirs) for (const ext of exts) {
        const abs = path.join(dir, baseNameNoExt + ext);
        try { if (fs.existsSync(abs)) return abs; } catch {}
    }
    return null;
}

function getWorkerIndex() {
    if (process.env.WORKER_INDEX != null) return Number(process.env.WORKER_INDEX);
    if (cluster.isWorker && typeof cluster.worker?.id === 'number') return cluster.worker.id - 1;
    return 0;
}

/* ====== Path Mounting helpers ====== */
function _normalizePrefix(p) { if (!p) return null; let s = String(p).trim(); if (!s) return null; if (!s.startsWith('/')) s = '/' + s; return s.replace(/\/+$/, ''); }
function _normalizeVersionPrefix(v) { if (!v) return null; const s = String(v).trim(); if (!s) return null; if (s.startsWith('/')) return s.replace(/\/+$/, ''); const m = s.match(/^v?(\d+)(?:\..*)?$/i); return m ? `/v${m[1]}` : `/${s.replace(/^\/+|\/+$/g, '')}`; }
function _normalizeRoutePath(p) { const s = String(p || '/'); return s.startsWith('/') ? s : '/' + s; }
function _prependIfMissing(basePath, segment) { if (!segment) return basePath; return basePath.startsWith(segment + '/') || basePath === segment ? basePath : `${segment}${basePath.startsWith('/') ? '' : '/'}${basePath}`; }
function _composeMountedPath(route, filePrefix, fileVersion) { const pfx = _normalizePrefix(route.prefix ?? filePrefix); const ver = _normalizeVersionPrefix(route.version ?? fileVersion); let finalPath = _normalizeRoutePath(route.path || '/'); if (ver) finalPath = _prependIfMissing(finalPath, ver); if (pfx) finalPath = _prependIfMissing(finalPath, pfx); return { path: finalPath, prefix: pfx || undefined, version: (route.version ?? fileVersion) || undefined }; }
function _applyMounting(routeDefs, filePrefix, fileVersion) { return routeDefs.map(r => { const { path, prefix, version } = _composeMountedPath(r, filePrefix, fileVersion); return { ...r, path, prefix, version }; }); }

/* ====== Middleware Discovery ====== */
function _walk(dir, out = []) {
    try {
        for (const name of fs.readdirSync(dir)) {
            const abs = path.join(dir, name);
            const st = fs.statSync(abs);
            if (st.isDirectory()) _walk(abs, out);
            else if (name.endsWith('.js') && !name.endsWith('.test.js') && !name.endsWith('.spec.js')) out.push(abs);
        }
    } catch {}
    return out;
}

function loadAppMiddlewares(appDirs, ctx, logger) {
    const loaded = [];
    for (const base of appDirs) {
        const dir = path.join(base, 'middleware');
        try { if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue; } catch { continue; }
        for (const file of _walk(dir)) {
            const baseName = path.basename(file);
            if (baseName === '_global.js') continue;
            try {
                const mod = require(file);
                const fileName = path.basename(file, path.extname(file));
                let name, handler;
                if (typeof mod === 'function') {
                    const maybe = mod.length <= 1 ? mod(ctx) : mod;
                    if (typeof maybe === 'function') { name = fileName; handler = maybe; }
                    else if (maybe && typeof maybe.handler === 'function') { name = maybe.name || fileName; handler = maybe.handler; }
                } else if (mod && typeof mod.create === 'function') {
                    const obj = mod.create(ctx);
                    if (obj && typeof obj.handler === 'function') { name = obj.name || fileName; handler = obj.handler; }
                } else if (mod && typeof mod.handler === 'function') {
                    name = mod.name || fileName; handler = mod.handler;
                }
                if (name && handler) { setMiddleware(name, handler); logger.info?.(`Registered middleware "${name}" from ${path.relative(process.cwd(), file)}`); loaded.push(name); }
                else logger.warn?.(`Skipped middleware (unrecognized export) at ${path.relative(process.cwd(), file)}`);
            } catch (e) { logger.warn?.(`Middleware load error for ${file}: ${e?.message}`); }
        }
    }
    return loaded;
}
// MessageBus is always created; Redis attach only when actually UP
const createRedisClient = () => {
    try {
        const Infra = require('../core/infra/InfraStatus');
        return Infra.isRedisUp() ? cache.duplicate() : null;
    } catch {
        return null;
    }
};


function loadGlobalStages(appDirs, ctx, logger) {
    for (const base of appDirs) {
        const p = path.join(base, 'middleware', '_global.js');
        try {
            if (!fs.existsSync(p)) continue;
            const mod = require(p);
            const val = (typeof mod === 'function') ? mod(ctx) : mod;
            const pre = Array.isArray(val?.pre) ? val.pre : [];
            const post = Array.isArray(val?.post) ? val.post : [];
            logger.info?.(`Loaded global stages from ${path.relative(process.cwd(), p)} (pre:${pre.length}, post:${post.length})`);
            return { pre, post };
        } catch (e) {
            logger.warn?.(`Global middleware load error: ${e?.message}`);
        }
    }
    return { pre: [], post: [] };
}

/* ====== Main ====== */
let heartbeat, metrics;
let offHb, offMetrics;
let aggTimer = null;
let aggPayload = { ts: 0, snapshot: Object.create(null) };

async function runWorkerInline() {
    if (typeof process.send === 'function') {
        process.on('message', (m) => {
            if (m && m.type === 'config:push') { setConfig(m.payload); log.info('Config updated via IPC'); }
        });
        try { process.send({ type: 'worker:online', pid: process.pid }); } catch {}
    }

    const cfg = getConfig();
    const appDirs = cfg.appDir ? [cfg.appDir] : appDirCandidates(cfg);
    const debugPaths = !!cfg.debugPaths || process.env.ZAPI_DEBUG_PATHS === '1';
    if (debugPaths) console.log('[Worker] appDir candidates:', appDirs);

    const workerIndex = getWorkerIndex();
    const leaderOnly = workerIndex === 0;

    // Express
    const app = express();
    app.locals.config = cfg;
    if (cfg.express?.trustProxy) app.set('trust proxy', true);
    app.use(express.json());

    // Core deps
    const cache = await createCache(cfg);

    // --- register infra guards so routes can use them by name ---
    setMiddleware('requireMongo', function requireMongo(_req, res, next) {
        try {
            const mongoose = require('mongoose');
            if (mongoose.connection?.readyState !== 1) {
                return res.status(503).json({ error: 'Mongo unavailable' });
            }
        } catch {}
        return next();
    });

    setMiddleware('requireRedis', function requireRedis(_req, res, next) {
        try {
            const client = cache?.raw?.();
            const ok = !!client && client.status === 'ready';
            if (!ok) {
                return res.status(503).json({ error: 'Redis unavailable' });
            }
        } catch {}
        return next();
    });

    // Non-blocking DB connector
    await startMongoConnector(cfg);

    // Event server + health + in-process system adapter
    const eventServer = new EventServer({ resolveService }); // auto-registers
    // 👇 only leader emits health change events (others keep local state only)
    const health = new HealthService({ emitEvents: leaderOnly });
    const sysAdapter = new SystemEventService({ resolveService }); // in-process
    await eventServer.start?.();
    await sysAdapter.start?.();
    await health.start?.();
    // --- Job Queue (service) ---
    try {
        const JobQueueServer = require('./JobQueueServer');
        const jq = new JobQueueServer();
        await jq.init();
        await jq.start();
    } catch (e) {
        console.warn('[JobQueue] init/start failed:', e?.message);
    }
    // --- Start MonitoringService ONLY on leader (avoid multi-echo) ---
    try {
        if (leaderOnly && cfg?.zapi?.monitoring?.enable !== false) {
            let mon = null;
            try { mon = require('../core/registry/services').resolveService('MonitoringService'); } catch {}
            if (!mon) {
                const CoreMonitoringService = require('../core/monitoring/MonitoringService');
                mon = new CoreMonitoringService(); // auto-registers
            }
            await mon.start?.();
        } else if (!leaderOnly) {
            console.log('[Worker] MonitoringService suppressed (leader-only).');
        } else {
            console.log('[Worker] MonitoringService disabled via zapi.monitoring.enable=false');
        }
    } catch (e) {
        console.warn('[Worker] MonitoringService start skipped:', e?.message);
    }
    // ---------------------------------------------------------

    // Announce early boot (leader-only)
    if (leaderOnly) await eventServer.publish('zapi:sys:boot:start', { pid: process.pid });

    // Bootstrap
    const bootPath = resolveInDirs(appDirs, 'bootstrap');
    if (debugPaths) console.log('[Worker] resolved bootstrap:', bootPath || '(not found)');
    if (!bootPath) throw new Error('Required host file missing: app/bootstrap.(js|cjs|mjs)');
    const bootFn = require(bootPath);
    if (typeof bootFn !== 'function') throw new Error(`app/bootstrap.* must export a function`);
    await bootFn({ cache, config: cfg, setService, setController, resolveService, resolveController });
    log.info(`Host app bootstrap executed: ${bootPath}`);
    if (leaderOnly) await eventServer.publish('zapi:sys:bootstrap:done', { appBootPath: bootPath });

    // Middleware + routes
    loadAppMiddlewares(appDirs, { cache, config: cfg, resolveService, resolveController }, log);
    const globalStages = loadGlobalStages(appDirs, { cache, config: cfg, resolveService, resolveController }, log);
    const routesPath = resolveInDirs(appDirs, 'routes');
    if (debugPaths) console.log('[Worker] resolved routes:', routesPath || '(not found)');
    if (!routesPath) throw new Error('Required host file missing: app/routes.(js|cjs|mjs)');
    const exported = require(routesPath);
    const val = (typeof exported === 'function') ? exported({ resolveController, resolveService }) : exported;
    let routeDefs, filePrefix = null, fileVersion = null;
    if (Array.isArray(val)) routeDefs = val;
    else if (val && Array.isArray(val.routes)) { routeDefs = val.routes; filePrefix = val.prefix ?? null; fileVersion = val.version ?? null; }
    else throw new Error('app/routes.* must export an array OR { routes:[...], prefix?, version? } OR a factory returning one of those');
    routeDefs = _applyMounting(routeDefs, filePrefix, fileVersion);
    log.info(`Using routes from host file: ${routesPath} (${routeDefs.length} route(s))`);
    const router = buildRouter(routeDefs, { globalPre: globalStages.pre, globalPost: globalStages.post });
    app.use(router);
    if (leaderOnly) await eventServer.publish('zapi:sys:routes:attached', { count: routeDefs.length, routesPath });

    // 🔹 BACKEND (optional)
    try {
        const basePath = (cfg?.zapi?.apiBackend?.basePath || '/_zapi').replace(/\/+$/, '') || '/_zapi';
        if (cfg?.zapi?.apiBackend?.enabled) {
            const BackendStateService = require('../core/backend/BackendStateService');
            const stateSvc = new BackendStateService();
            await stateSvc.start?.();

            const { buildRouter: buildBackend } = require('../core/backend/ApiBackendRouter');
            app.use(basePath, buildBackend(cfg));
            log.info(`[backend] mounted at ${basePath}`);
            if (leaderOnly) await eventServer.publish('zapi:sys:backend:ready', { basePath });
        } else {
            log.info(`[backend] disabled by config`);
        }
    } catch (e) {
        log.warn(`[backend] failed to mount: ${e?.message}`);
    }

    // ---------- Always-on MessageBus / Heartbeat / Metrics ----------
    let wsHandle = null;
    let bus = null;


    bus = new MessageBus({
        prefix: cfg.websocket?.prefix || 'ws',
        createRedisClient // may return null; MessageBus now handles this
    });

    // Metrics aggregation (leader-only fan-in → single zapi event)
    const aggWinMs = Number(cfg.metrics?.aggregateWindowMs ?? 200);
    async function flushAggregated() {
        const payload = { ts: aggPayload.ts || Date.now(), snapshot: { ...aggPayload.snapshot } };
        aggPayload = { ts: 0, snapshot: Object.create(null) };
        aggTimer = null;
        try { if (leaderOnly) await eventServer.publish('zapi:sys:metrics:flush', payload); } catch {}
    }
    function onMetricsFlush(evt) {
        if (!evt || typeof evt !== 'object' || !evt.snapshot) return;
        aggPayload.ts = Math.max(aggPayload.ts, Number(evt.ts || 0));
        for (const [k, v] of Object.entries(evt.snapshot)) {
            aggPayload.snapshot[k] = (aggPayload.snapshot[k] || 0) + Number(v || 0);
        }
        if (!aggTimer) aggTimer = setTimeout(flushAggregated, aggWinMs);
    }

    // Heartbeat state & aggregator (leader-only)
    const sCfg = (cfg?.zapi?.monitoring?.system) || {};
    const sysEnabled = sCfg.broadcast !== false;            // default true
    const sysMs = Number(sCfg.intervalMs ?? 60000);         // default 60s
    const sysDetail = (sCfg.detail === 'full') ? 'full' : 'summary';
    const hbState = new Map(); // key `${nodeId}|${pid}` -> snapshot

    function onWorkerHeartbeat(evt) {
        if (!evt) return;
        const key = `${evt.nodeId}|${evt.pid}`;
        hbState.set(key, {
            pid: Number(evt.pid),
            nodeId: String(evt.nodeId),
            workerIndex: Number(evt.workerIndex ?? -1),
            ts: Number(evt.ts || Date.now()),
            uptimeSec: Number(evt.uptimeSec || 0),
            rss: Number(evt.rss || 0),
            heapUsed: Number(evt.heapUsed || 0)
        });
    }

    // Ingest IPC-forwarded heartbeats from the primary (works without Redis/WS)
    try {
        process.on('message', (m) => {
            if (m && m.type === 'sys:heartbeat' && m.payload) {
                try { if (leaderOnly) onWorkerHeartbeat(m.payload); } catch {}
            }
        });
    } catch {}

    // Subscribe on bus (leader-only), NON-BLOCKING, and publish periodic snapshot
    if (leaderOnly && bus?.subscribe) {
        bus.subscribe('sys:heartbeat', onWorkerHeartbeat).then(off => { offHb = off; }).catch(()=>{});
        bus.subscribe('sys:metrics:flush', onMetricsFlush).then(off => { offMetrics = off; }).catch(()=>{});

        if (sysEnabled && eventServer) {
            setInterval(async () => {
                try {
                    const expectedTotal = Math.max(1, Number(cfg.express?.workers || 1));
                    const workersArr = Array.from(hbState.values());

                    const observed = workersArr.length;
                    const arr = (k) => workersArr.map(w => Number(w[k] || 0));
                    const avg = a => (a.length ? Math.round(a.reduce((x,y)=>x+y,0) / a.length) : 0);
                    const max = a => (a.length ? Math.max(...a) : 0);
                    const min = a => (a.length ? Math.min(...a) : 0);

                    const uptime = arr('uptimeSec');
                    const rss    = arr('rss');
                    const heap   = arr('heapUsed');

                    const payload = {
                        ts: Date.now(),
                        expected: { total: expectedTotal },
                        observed: { total: observed },
                        stats: {
                            uptimeSec: { min: min(uptime), avg: avg(uptime), max: max(uptime) },
                            rss:       { min: min(rss),    avg: avg(rss),    max: max(rss)    },
                            heapUsed:  { min: min(heap),   avg: avg(heap),   max: max(heap)   }
                        },
                        ...(sysDetail === 'full' ? { workers: workersArr } : undefined)
                    };

                    await eventServer.publish('zapi:sys:heartbeat:snapshot', payload);
                } catch {}
            }, sysMs);
        }
    }

    // Start heartbeat + metrics (ALWAYS ON; they publish per-worker but only leader aggregates/logs)
    heartbeat = createClusterHeartbeat({ bus });
    await heartbeat.start();

    metrics = createMetricsIngestor({ bus, quiet: !leaderOnly }); // let ingestor be quiet on non-leaders if it supports
    await metrics.start();

    // ---------- WebSocket (optional) ----------

    if (cfg.websocket?.enable) {
        // Only leader needs WsEventService adapter to avoid duplicate "auto-registered" logs
        const basePort = Number(cfg.websocket.port || 8081);
        const port = basePort + workerIndex;

        wsHandle = await startWebSocketServer({
            port,
            heartbeatMs: cfg.websocket.heartbeatIntervalMs || 30000,
            onReady: ({ wss }) => log.info(`WebSocket listening on :${port} (worker ${workerIndex})`)
        });

        // Register BusService on every worker (so each WS server can publish/receive)
        const { BusService } = require('../ws/BusService');
        const busService = new BusService({ bus, wss: wsHandle.wss, cache, config: cfg });
        await busService.init?.();
        await busService.start?.();

        if (leaderOnly) {
            const wsAdapter = new WsEventService({ wsContext: { broadcast: wsHandle.broadcastJSON } });
            await wsAdapter.start?.();
            await eventServer.publish('zapi:sys:ws:ready', { port, workerIndex });
        }
    }

    // 🔹 Redis transport ONLY on leader (avoid N auto-registered logs)
    if (cfg.redis && leaderOnly) {
        const redisAdapter = new RedisEventService({ cache });
        await redisAdapter.start?.();
    }

    // HTTP Listen (per-worker), but publish http:ready only from leader
    const httpPort = cfg.express?.port || 3000;
    const server = app.listen(httpPort, async () => {
        log.info(`PID ${process.pid} listening on :${httpPort}`);
        try { if (leaderOnly) await eventServer.publish('zapi:sys:http:ready', { port: httpPort }); } catch {}
    });

    // Graceful shutdown
    const shutdown = async () => {
        try {
            try { if (leaderOnly) await eventServer.publish('zapi:sys:shutdown:init', { pid: process.pid }); } catch {}

            try { offHb?.(); } catch {}
            try { offMetrics?.(); } catch {}
            offHb = offMetrics = null;
            try { if (aggTimer) clearTimeout(aggTimer); } catch {}

            if (metrics) await metrics.stop();
            if (heartbeat) await heartbeat.stop();

            if (wsHandle) await wsHandle.close();
            if (bus) await bus.close();

            await disconnectMongo();
            await cache.quit();

            try { if (leaderOnly) await eventServer.publish('zapi:sys:shutdown:done', { pid: process.pid }); } catch {}
            try { await eventServer.stop?.(); } catch {}
        } finally {
            server.close(() => process.exit(0));
        }
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

module.exports = { runWorkerInline };
