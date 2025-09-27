'use strict';

const {Logger} = require('./Logger');
const svcReg = require('./registry/services');
const ctrlReg = require('./registry/controllers');
const Infra = require('./infra/InfraStatus');
function _requireMongo(_req, res, next) {
    if (!Infra.isMongoUp()) return res.status(503).json({ error: 'Mongo unavailable' });
    next();
}
function _requireRedis(_req, res, next) {
    if (!Infra.isRedisUp()) return res.status(503).json({ error: 'Redis unavailable' });
    next();
}
/**
 * Factory → returns a middleware that can require mongo/redis (or both).
 * @param {{ mongo?:boolean, redis?:boolean, message?:string }} options
 */
function _requireInfra(options = {}) {
    const { mongo = false, redis = false, message } = options;
    return function requireInfra(req, res, next) {
        if (mongo && !Infra.isMongoUp()) return res.status(503).json({ error: message || 'Mongo unavailable' });
        if (redis && !Infra.isRedisUp()) return res.status(503).json({ error: message || 'Redis unavailable' });
        next();
    };
}
/**
 * BaseLifecycle
 * - Common lifecycle hooks: init/start/stop (no-ops by default)
 * - Structured logger: this.log
 * - **Auto-registration** into controller/service registries
 *
 * Auto-register behavior:
 *   new Something({ kind: 'service', name: 'FooService' })
 *   new Something({ kind: 'controller', name: 'FooController' })
 *
 * Conventions if not provided:
 *   - name:   opts.name || static artifactName || constructor.name
 *   - kind:   opts.kind || static artifactKind || infer from name ("Service" -> service, else controller)
 *   - autoRegister: true (pass { autoRegister:false } to opt out)
 *   - ifAlready: 'replace' | 'keep'  (default 'replace')
 */
class BaseLifecycle {
    constructor(nameOrOpts, maybeOpts) {
        const opts = typeof nameOrOpts === 'string' ? {...(maybeOpts || {}), name: nameOrOpts} : (nameOrOpts || {});
        this.name = opts.name || this.constructor.artifactName || this.constructor.name || 'Artifact';
        this.kind = (opts.kind || this.constructor.artifactKind || inferKindFromName(this.name)).toLowerCase();
        this.autoRegister = opts.autoRegister !== false;
        this.ifAlready = opts.ifAlready || 'replace';

        this.log = new Logger(this.name);

        if (this.autoRegister) this._autoRegister();
    }

    /* lifecycle hooks (override in subclasses) */
    async init() {
    }

    async start() {
    }

    async stop() {
    }
    get requireMongo() { return _requireMongo; }
    get requireRedis() { return _requireRedis; }
    requireInfra(opts) { return _requireInfra(opts); }

    // ⬇️ NEW: static accessors so callers can use `BaseLifecycle.requireMongo` etc.
    static requireMongo(_req, res, next) {
        try {
            const mongoose = require('mongoose');
            if (mongoose.connection?.readyState !== 1) {
                return res.status(503).json({ error: 'Mongo unavailable' });
            }
        } catch {}
        return next();
    }

    static requireRedis(cache) {
        return function(_req, res, next) {
            try {
                const client = cache?.raw?.();
                const ok = !!client && client.status === 'ready';
                if (!ok) return res.status(503).json({ error: 'Redis unavailable' });
            } catch {}
            return next();
        };
    }
    static requireInfra(opts) { return _requireInfra(opts); }
    _autoRegister() {
        if (this.kind === 'service') {
            const exists = svcReg.hasService?.(this.name);
            if (exists && this.ifAlready === 'keep') return;
            if (exists && this.ifAlready === 'replace') svcReg.deleteService?.(this.name);
            svcReg.setService(this.name, this);
            this.log.info(`auto-registered service "${this.name}"`);
        } else if (this.kind === 'controller') {
            const exists = ctrlReg.hasController?.(this.name);
            if (exists && this.ifAlready === 'keep') return;
            if (exists && this.ifAlready === 'replace') ctrlReg.deleteController?.(this.name);
            ctrlReg.setController(this.name, this);
            this.log.info(`auto-registered controller "${this.name}"`);
        } else {
            this.log.warn(`unknown kind "${this.kind}" — not auto-registered`);
        }
    }

    unregister() {
        if (this.kind === 'service') return svcReg.deleteService?.(this.name);
        if (this.kind === 'controller') return ctrlReg.deleteController?.(this.name);
    }

    /**
     * Convenience helper: emit a zapi:* event with envelope auto-header.
     * Usage: this.emitZapi('sys:ready', { detail: 'HTTP up' })
     */
    async emitZapi(suffix, payload) {
        try {
            const {resolveService} = require('./registry/services');
            const EventServer = resolveService('EventServer');
            const name = `zapi:${String(suffix || '').replace(/^zapi:/, '')}`;
            return EventServer.publish(name, payload);
        } catch {
            // EventServer not ready yet; drop silently or buffer here if preferred
        }
    }

}

function inferKindFromName(n) {
    return /service$/i.test(n) ? 'service' : 'controller';
}

module.exports = {BaseLifecycle};
