/* --- FILE: src\Core\BaseRepository.js --- */
'use strict';

const BaseArtifact = require('./BaseArtifact');

/**
 * BaseRepository
 * - Extends BaseArtifact so repos auto-register with the framework.
 * - Stores an injected model (object with CRUD methods) and provides
 *   thin pass-through helpers used by ExampleApp.
 * - Non-Mongo repos can use this directly; Mongo repos can extend BaseMongoRepository.
 */
class BaseRepository extends BaseArtifact {
    static kind = 'repository';

    /**
     * @param {object} opts
     * @param {object} opts.framework                - required (for auto-register)
     * @param {string} [opts.name]                   - repo name used in registry
     * @param {object} [opts.model]                  - optional model with CRUD surface
     * @param {{info?:Function,warn?:Function,error?:Function,debug?:Function}} [opts.logger]
     * @param {object} [opts.config]
     */
    constructor({ framework, name, model, logger, config } = {}) {
        super({ framework, name });
        this.logger = logger || console;
        this.config = config || {};
        this.model = model || null; // optional; subclasses can set later
    }

    /** Swap logger at runtime. */
    setLogger(logger) { this.logger = logger || this.logger; return this; }
    /** Attach/replace backing model (object exposing CRUD). */
    setModel(model) { this.model = model; return this; }

    // ---------- Generic CRUD pass-throughs (used by ExampleApp) ----------

    async create(data, ...rest) {
        this._ensureModel('create');
        return this.model.create(data, ...rest);
    }

    async findById(id, ...rest) {
        this._ensureModel('findById');
        return this.model.findById(id, ...rest);
    }

    async find(filter = {}, ...rest) {
        this._ensureModel('find');
        return this.model.find(filter, ...rest);
    }

    async update(id, patch, ...rest) {
        // generic update for in-memory models
        if (this.model?.update) return this.model.update(id, patch, ...rest);
        // fall back to updateOne shape if present
        if (this.model?.updateOne) return this.model.updateOne({ id }, { $set: patch }, ...rest);
        throw new Error(`[${this.name}] model has no update or updateOne`);
    }

    async remove(id, ...rest) {
        this._ensureModel('remove');
        return this.model.remove(id, ...rest);
    }

    async cacheCall({ name, suffix, ttlOverride }, producer) {
        const { getCacheKey, buildKey } = require('./CacheKeyRegistry');
        const def = getCacheKey(this.framework, name);
        const key = buildKey({ framework: this.framework, name, suffix: suffix ?? '' });
        const ttl = Number.isFinite(ttlOverride) ? ttlOverride : def?.ttl;
        return this.framework.cache.cacheAside({ key, ttl }, producer);
    }

    // ---------- Utils ----------
    _ensureModel(op) {
        if (!this.model) {
            throw new Error(`[${this.name}] no model attached; required for ${op}. ` +
                `Pass { model } to constructor or call setModel(model).`);
        }
    }
}

module.exports = BaseRepository;
