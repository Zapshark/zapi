'use strict';
const Redis = require('ioredis');
const { BaseLifecycle } = require('../BaseLifecycle');
const { resolveService, setService } = require('../registry/services');
const Outage = require('../infra/OutageDeduper');

const { getServerName } = require('../Config');
function retryMs(times){ return Math.min(times * 10000, 60000); }
function attachQuiet(c, key){
    const { resolveService } = require('../registry/services');
    c.on('error', (err) => { const reason = err?.code || err?.message; if (Outage.down(key,{reason}).emitted) { try { const es=resolveService('EventServer'); const leader = Number(process.env.WORKER_INDEX ?? 0)===0; if (leader) es?.publish('zapi:infra:redis:down',{reason,ts:Date.now()}); } catch{} }});
    c.on('ready', () => { if (Outage.up(key).emitted) { try { const es=resolveService('EventServer'); const leader = Number(process.env.WORKER_INDEX ?? 0)===0; if (leader) es?.publish('zapi:infra:redis:up',{ts:Date.now()}); } catch{} }});
}

class RedisEventService extends BaseLifecycle {
    static artifactName = 'RedisEventService';
    static artifactKind  = 'service';

    constructor({ cache } = {}) {
        super({ name: RedisEventService.artifactName, kind: RedisEventService.artifactKind });
        this.cache = cache;
        this.pub = this.sub = this.off = null;
        setService(RedisEventService.artifactName, this);
        console.log('[RedisEventService] auto-registered service "RedisEventService"');
    }

    async start() {
        const cfg = require('../Config').getConfig?.() || {};
        const EventServer = resolveService('EventServer');
        if (!EventServer) return;

        const key = 'redis:eventbus';
        if (this.cache?.duplicate) {
            this.pub = this.cache.duplicate();  attachQuiet(this.pub, key+':pub');
            this.sub = this.cache.duplicate();  attachQuiet(this.sub, key+':sub');
        } else if (cfg.redis) {
            const baseOpts = { retryStrategy: retryMs, maxRetriesPerRequest: null, lazyConnect: true };
            const url = cfg.redis.url;
            this.pub = url ? new Redis(url, baseOpts) : new Redis({ host: cfg.redis.host, port: cfg.redis.port, password: cfg.redis.password, db: cfg.redis.db, ...baseOpts });
            this.sub = url ? new Redis(url, baseOpts) : new Redis({ host: cfg.redis.host, port: cfg.redis.port, password: cfg.redis.password, db: cfg.redis.db, ...baseOpts });
            attachQuiet(this.pub, key+':pub'); attachQuiet(this.sub, key+':sub');
        } else {
            return;
        }

        const unreg = EventServer.registerAdapter({
            publish: async (env) => { try { await this.pub.publish(env.event, JSON.stringify(env)); } catch {} }
        });
        this.off = () => { try { unreg(); } catch {} };

        await this.sub.psubscribe('zapi:*');
        const selfPid = process.pid, selfWI = Number(process.env.WORKER_INDEX ?? -1);
 const selfOrigin = getServerName();

        this.sub.on('pmessage', (_p, channel, message) => {
            try {
                const env = JSON.parse(message);
                const meta = env?.eventHeader?.state?.meta || {};
                const origin = env?.eventHeader?.origin;
                if (meta.pid === selfPid && meta.workerIndex === selfWI && origin === selfOrigin) return;
                EventServer.local.emit(channel, env);
                EventServer.local.emit('*', env);
            } catch {}
        });
    }

    async stop() {
        try { this.off?.(); } catch {}
        try { await this.sub?.quit(); } catch {}
        try { await this.pub?.quit(); } catch {}
        this.off = this.sub = this.pub = null;
    }
}

module.exports = RedisEventService;
