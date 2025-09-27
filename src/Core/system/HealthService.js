// src/core/system/HealthService.js
'use strict';
const { BaseLifecycle } = require('../BaseLifecycle');
const { getConfig } = require('../Config');
const Infra = require('../infra/InfraStatus'); // emits 'mongoUp:up/down', 'redisUp:up/down'

class HealthService extends BaseLifecycle {
    static artifactName = 'HealthService';
    static artifactKind  = 'service';

    constructor() {
        super({ name: HealthService.artifactName, kind: HealthService.artifactKind });
        this._state = { status: 'Ok', meta: {} };

        // track deps + what is required
        this._deps = { mongo: null, redis: null };
        this._required = { mongo: false, redis: false };
        this._offs = [];
    }

    getState() {
        return { ...this._state, meta: { ...(this._state.meta || {}) } };
    }

    setStatus(status, meta = {}) {
        this._state = { status: String(status || 'Ok'), meta };
    }

    async start() {
        const cfg = getConfig?.() || {};

        // by default: require a dep iff it’s configured; allow explicit overrides:
        const cfgReq = cfg?.zapi?.health?.require || {};
        const redisConfigured = !!(cfg?.redis && (cfg.redis.url || cfg.redis.host));
        const mongoConfigured = !!(cfg?.mongo && cfg.mongo.uri);

        this._required.redis = typeof cfgReq.redis === 'boolean' ? cfgReq.redis : redisConfigured;
        this._required.mongo = typeof cfgReq.mongo === 'boolean' ? cfgReq.mongo : mongoConfigured;

        // seed current values from Infra
        this._deps.mongo = Infra.isMongoUp();
        this._deps.redis = Infra.isRedisUp();
        this._recalc({ boot: true });

        // subscribe to infra signals
        const on = (evt, fn) => { Infra.on(evt, fn); this._offs.push(() => Infra.off(evt, fn)); };

        on('mongoUp:up',   () => { this._deps.mongo = true;  this._recalc(); });
        on('mongoUp:down', (e) => { this._deps.mongo = false; this._recalc({ reason: e?.reason || 'down' }); });

        on('redisUp:up',   () => { this._deps.redis = true;  this._recalc(); });
        on('redisUp:down', (e) => { this._deps.redis = false; this._recalc({ reason: e?.reason || 'down' }); });
    }

    async stop() {
        for (const off of this._offs.splice(0)) { try { off(); } catch {} }
    }

    _recalc(extra = {}) {
        const missing = [];
        if (this._required.mongo && !this._deps.mongo) missing.push('mongo');
        if (this._required.redis && !this._deps.redis) missing.push('redis');

        const nextStatus = (missing.length === 0) ? 'Ok' : 'NotOk';
        const prevStatus = this._state.status;

        this._state = {
            status: nextStatus,
            meta: {
                ...extra,
                deps: { ...this._deps },
                required: { ...this._required },
                missing
            }
        };

        // Only announce when status actually changes
        if (nextStatus !== prevStatus) {
            // envelopes already include health via EventServer.publish; this just emits a convenience event
            this.emitZapi('sys:health:changed', this._state).catch(() => {});
        }
    }
}

module.exports = HealthService;
