'use strict';

const Redis = require('ioredis');
const Outage = require('../core/infra/OutageDeduper');
const Infra = require('../core/infra/InfraStatus');
const { resolveService } = require('../core/registry/services');

function retryMs(times) { return Math.min(times * 10000, 60000); } // 10→60s

function redisConfigured(cfg) {
    const r = cfg?.redis || {};
    return !!(r.url || r.host || process.env.REDIS_URL || process.env.REDIS_HOST);
}

async function emit(kind, phase, payload) {
    try {
        const EventServer = resolveService('EventServer');
        await EventServer?.publish?.(`zapi:infra:${kind}:${phase}`, payload);
    } catch {}
}

function attachQuiet(client, key) {
    client.on('error', (err) => {
        const reason = err?.code || err?.message || 'unknown';
        if (Outage.down(key, { reason }).emitted) emit('redis', 'down', { reason, ts: Date.now() });
        Infra.set('redisUp', false, { reason });
    });
    const up = () => {
        if (Outage.up(key).emitted) emit('redis', 'up', { ts: Date.now() });
        Infra.set('redisUp', true);
    };
    client.on('connect', up);
    client.on('ready', up);
    client.on('end', () => Infra.set('redisUp', false, { reason: 'end' }));
}

/**
 * Resilient cache: uses Redis when up; otherwise an in-memory Map as a soft fallback.
 * Startup never blocks; Redis connection is lazy & retried quietly.
 */
async function createCache(cfg = {}) {
    // Soft fallback cache
    const mem = new Map();

    if (!redisConfigured(cfg)) {
        // No Redis configured → forever in-memory (explicitly "up" = false)
        Infra.set('redisUp', false, { reason: 'not-configured' });
        return {
            async get(k) { return mem.has(k) ? mem.get(k) : null; },
            async set(k, v, ttl) { mem.set(k, v); if (ttl > 0) setTimeout(() => mem.delete(k), ttl * 1000); return 'OK'; },
            async del(k) { const had = mem.delete(k); return had ? 1 : 0; },
            async delPath(prefix) { let c = 0; for (const k of [...mem.keys()]) if (k.startsWith(prefix)) { mem.delete(k); c++; } return c; },
            raw() { return null; },
            duplicate() { return null; },
            async quit() {}
        };
    }

    // Redis client with lazy connect and scaling retry
    const r = cfg.redis || {};
    const baseOpts = { retryStrategy: retryMs, maxRetriesPerRequest: null, lazyConnect: true, enableReadyCheck: true };
    const client = r.url
        ? new Redis(r.url, baseOpts)
        : new Redis({ host: r.host || '127.0.0.1', port: r.port || 6379, password: r.password, db: r.db, keyPrefix: r.keyPrefix, ...baseOpts });

    attachQuiet(client, 'redis:cache');

    // Degraded ops: if redis is down, transparently use mem
    const useRedis = () => Infra.isRedisUp() && client.status !== 'end';

    return {
        async get(key) {
            if (!useRedis()) return mem.has(key) ? mem.get(key) : null;
            const s = await client.get(key);
            return s ? JSON.parse(s) : null;
        },
        async set(key, val, ttlSec) {
            if (!useRedis()) { mem.set(key, val); if (ttlSec && ttlSec > 0) setTimeout(() => mem.delete(key), ttlSec * 1000); return 'OK'; }
            const s = JSON.stringify(val);
            return ttlSec && ttlSec > 0 ? client.set(key, s, 'EX', ttlSec) : client.set(key, s);
        },
        async del(key) { return useRedis() ? client.del(key) : (mem.delete(key) ? 1 : 0); },
        async delPath(prefix) {
            if (!useRedis()) { let c = 0; for (const k of [...mem.keys()]) if (k.startsWith(prefix)) { mem.delete(k); c++; } return c; }
            let cursor = '0', total = 0;
            do {
                const [next, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
                cursor = next;
                if (keys.length) total += await client.del(keys);
            } while (cursor !== '0');
            return total;
        },
        raw() { return client; },
        duplicate() {
            const dup = client.duplicate();
            attachQuiet(dup, 'redis:cache:dup');
            return dup;
        },
        async quit() { try { await client.quit(); } catch {} }
    };
}

module.exports = { createCache };
