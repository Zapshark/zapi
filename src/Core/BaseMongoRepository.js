'use strict';

const BaseRepository = require('./BaseRepository');

/**
 * BaseMongoRepository
 * - Extends BaseRepository with MongoDB/Mongoose helpers.
 * - No "Manager" required; repositories subclass this directly.
 * - Supports multiple named connections and lazy model registration.
 *
 * Usage (in a concrete repo):
 *   class UserRepository extends BaseMongoRepository {
 *     static modelName = 'User';
 *     static schema = new (require('mongoose').Schema)(
 *       { email: { type: String, required: true, index: true }, displayName: String },
 *       { timestamps: true, versionKey: false }
 *     );
 *   }
 *   // Once at app bootstrap:
 *   await BaseMongoRepository.configure({ uri: process.env.MONGO_URI, name: 'default', logger: Common?.Logging });
 *   // Then anywhere:
 *   const users = new UserRepository();
 *   await users.ensureModel(); // lazy register
 *   const u = await users.create({ email: 'a@b.com' });
 */
class BaseMongoRepository extends BaseRepository {
    /**
     * Global (per-process) shared state across all BaseMongoRepository subclasses.
     * We intentionally keep them on the constructor so all subclasses share.
     */
    static _mongoose = null;                 // cached mongoose module
    static _connections = new Map();         // name -> mongoose.Connection
    static _logger = { info(){}, warn(){}, error(){}, debug(){} };
    static dbName = undefined; // optional per-repo default database

    /**
     * Prepare a mongoose instance (soft-require).
     * @returns {import('mongoose')}
     * @private
     */
    static _getMongoose() {
        if (this._mongoose) return this._mongoose;
        try {
            // eslint-disable-next-line global-require
            this._mongoose = require('mongoose');
            return this._mongoose;
        } catch (err) {
            const e = new Error('[BaseMongoRepository] "mongoose" not found. Install: npm i mongoose');
            e.cause = err;
            throw e;
        }
    }

    /**
     * Configure (or reuse) a named connection for all repos.
     * Call once during bootstrap per connection you need.
     * @param {object} p
     * @param {string} p.uri - MongoDB URI
     * @param {string} [p.name='default'] - connection name
     * @param {object} [p.options] - mongoose connection options
     * @param {{info?:Function,warn?:Function,error?:Function,debug?:Function}} [p.logger]
     * @param {import('mongoose').Connection} [p.connection] - use existing connection (optional)
     * @returns {Promise<import('mongoose').Connection>}
     */
    static async configure({ uri, name = 'default', options, logger, connection } = {}) {
        if (!uri && !connection) throw new Error('[BaseMongoRepository.configure] requires { uri } or { connection }');
        if (logger) this._logger = logger;

        if (this._connections.has(name)) {
            const reuse = this._connections.get(name);
            if (reuse?.readyState === 1) return reuse;
        }

        if (connection) {
            this._connections.set(name, connection);
            this._logger.info?.(`[BaseMongoRepository] Reusing provided connection "${name}"`);
            return connection;
        }

        const mongoose = this._getMongoose();
        const merged = { maxPoolSize: 10, autoIndex: true, serverSelectionTimeoutMS: 12000, ...options };
        const opts = this._stripDeprecatedDriverOptions(merged);

        const conn = await mongoose.createConnection(uri, opts).asPromise();
        this._connections.set(name, conn);
        this._logger.info?.(`[BaseMongoRepository] Connected Mongo "${name}"`);
        return conn;
    }

    /**
     * Close a connection (or all).
     * @param {string} [name]
     */
    static async disconnect(name) {
        if (name) {
            const c = this._connections.get(name);
            if (c) {
                try { await c.close(true); } catch (err) { this._logger.warn?.(`[BaseMongoRepository] disconnect warn "${name}": ${err.message}`); }
            }
            this._connections.delete(name);
            return 1;
        }
        const all = [...this._connections.values()];
        await Promise.all(all.map(async (c) => { try { await c.close(true); } catch {} }));
        this._connections.clear();
        return all.length;
    }

    /**
     * Retrieve a named connection.
     * @param {string} [name='default']
     * @returns {import('mongoose').Connection|null}
     */
    static getConnection(name = 'default') {
        return this._connections.get(name) || null;
    }

    // ---------- MULTI-CONNECTION CONFIG HELPERS (NEW) ----------

    /**
     * Truthy coercion for typical env values.
     */
    static _toBool(v) {
        if (typeof v === 'boolean') return v;
        if (v == null) return false;
        const s = String(v).trim().toLowerCase();
        return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
    }

    /**
     * Build { uri, options } for a single connection entry.
     * Behavior:
     *  - If dbName === '' (explicit empty string), DO NOT append a database to the URI.
     *  - If dbName is undefined/null, default to "myapp" and ensure it exists on the URI.
     *  - If dbName is a non-empty string, ensure it exists on the URI.
     *  - If authenticate is truthy, pass user/pass via options (safer than embedding in URI).
     *
     * @param {{
     *   uri?: string,
     *   user?: string,
     *   pass?: string,
     *   dbName?: string | null,
     *   authenticate?: boolean|string,
     *   options?: object
     * }} entry
     * @returns {{ uri: string, options: object }}
     */
    static buildConnectionParamsFromEntry(entry = {}) {
        const baseUri = entry.uri || 'mongodb://localhost:27017/';
        const authenticate = this._toBool(entry.authenticate);

        // Decide dbName semantics:
        // - undefined/null -> default "myapp"
        // - '' (explicit empty) -> do NOT attach a db; keep URI as-is
        // - any non-empty -> attach/ensure it on the URI
        const hasExplicitEmpty = entry.dbName === '';
        const effectiveDb = hasExplicitEmpty ? '' : ((entry.dbName && String(entry.dbName).trim()) || 'myapp');

        let uri = baseUri;
        if (effectiveDb) {
            try {
                const u = new URL(baseUri);
                if (!u.pathname || u.pathname === '/' || u.pathname === '') {
                    u.pathname = `/${effectiveDb}`;
                }
                uri = u.toString();
            } catch {
                if (!/mongodb(?:\+srv)?:\/\/[^/]+\/[^?]*/i.test(baseUri)) {
                    uri = baseUri.replace(/\/?$/, '/') + effectiveDb;
                }
            }
        } // else: explicit '' means leave the URI as provided

        // Merge options + auth (if requested)
        const options = {
            maxPoolSize: 10,
            autoIndex: true,
            serverSelectionTimeoutMS: 12000,
            ...(entry.options || {})
        };
        if (authenticate) {
            if (entry.user) options.user = entry.user;
            if (entry.pass) options.pass = entry.pass;
            // If caller didn’t specify authSource, default to effectiveDb when set
            if (effectiveDb && !options.authSource) options.authSource = effectiveDb;
        }
        return { uri, options: this._stripDeprecatedDriverOptions(options) };

    }

    /**
     * Configure multiple named connections from a config of the form:
     * { connections: { default: { ... }, analytics: { ... } } }
     *
     * @param {{ connections: Record<string, any>, logger?: any }} p
     * @returns {Promise<Array<{name:string, connected:boolean}>>}
     */
    static async configureFromConnectionsConfig({ connections, logger } = {}) {
        if (!connections || typeof connections !== 'object') {
            throw new Error('[BaseMongoRepository.configureFromConnectionsConfig] requires { connections }');
        }
        if (logger) this._logger = logger;

        const results = [];
        for (const [name, entry] of Object.entries(connections)) {
            const { uri, options } = this.buildConnectionParamsFromEntry(entry || {});
            await this.configure({ uri, name, options, logger: this._logger });
            results.push({ name, connected: true });
        }
        return results;
    }

    /**
     * Pull the MongoDB config from the framework registry and wire every connection.
     * By default reads the 'MongoDB' config entry your loader registers.
     *
     * @param {{ framework:any, key?:string, logger?:any }} p
     */
    static async configureFromFrameworkConnections({ framework, key = 'MongoDB', logger } = {}) {
        if (!framework) throw new Error('[BaseMongoRepository.configureFromFrameworkConnections] requires { framework }');
        const cfg = framework.resolve('config', key);
        if (!cfg || typeof cfg !== 'object' || !cfg.connections) {
            throw new Error(`[BaseMongoRepository] config entry "${key}" missing { connections }`);
        }
        return this.configureFromConnectionsConfig({ connections: cfg.connections, logger: logger || this._logger });
    }



    /**
     * @param {object} [opts]
     * @param {string} [opts.connection='default'] - which named connection this repo uses
     * @param {object} [opts.logger]
     * @param {object} [opts.config]
     */


    constructor({ framework, connection = 'default', logger, config, name, dbName } = {}) {
        super({ framework, name, logger: logger || BaseMongoRepository._logger, config });
        this.connectionName = connection;
        this._dbName = dbName;          // ⬅️ NEW: instance-level database override
        this._model = null;
    }


    _resolveSchemaFromRegistry() {
        const bucket = this.framework?.registries?.get('modelSchemas');
        if (!bucket) return null;
        // Prefer connection-specific
        const keyConn = `${this.connectionName}:${this.modelName}`;
        if (bucket.has(keyConn)) return bucket.get(keyConn);
        // Fallback to alias (single-conn or unique)
        if (bucket.has(this.modelName)) return bucket.get(this.modelName);
        return null;
    }

    /**
     * Override in subclass or attach statically:
     *   static modelName = 'Thing';
     *   static schema = new mongoose.Schema({...});
     */
    static modelName = undefined;
    static schema = undefined;

    /** The default model name for this repository (checks static modelName then class name). */
    get modelName() {
        return (this.constructor.modelName || this.constructor.name.replace(/Repository$/, '')) || this.constructor.name;
    }

    /** The schema definition (static). Subclasses should provide it. */
    get schema() {
        return this.constructor.schema;
    }

    // add near other statics/helpers
    static _stripDeprecatedDriverOptions(opts = {}) {
        const cleaned = { ...opts };
        const deprecated = ['useNewUrlParser', 'useUnifiedTopology'];
        let removed = [];
        for (const k of deprecated) {
            if (k in cleaned) { delete cleaned[k]; removed.push(k); }
        }
        if (removed.length) {
            this._logger?.warn?.(`[Mongo] Stripped deprecated options: ${removed.join(', ')}`);
        }
        return cleaned;
    }


    /**
     * Ensure the Mongoose model is registered on this repo's connection.
     * Safe to call multiple times (idempotent).
     * @returns {Promise<import('mongoose').Model>}
     */
    async ensureModel() {
        if (this._model) return this._model;

        const baseConn = this.constructor.getConnection(this.connectionName);
        if (!baseConn) throw new Error(`[${this.name}] connection "${this.connectionName}" not configured. Call BaseMongoRepository.configure(...) first.`);

        // Priority 1: explicit static schema
        let schema = this.schema;
        let collection = undefined;
        let entry = null;

        // Priority 2: resolve from registry
        if (!schema) {
            entry = this._resolveSchemaFromRegistry();
            if (!entry) {
                throw new Error(`[${this.name}] missing schema. Define static schema OR add "${this.modelName}.model.js" under App/Models${this.connectionName ? `/${this.connectionName}` : ''}`);
            }
            schema = entry.schema;
            collection = entry.collection;
        }

        // Decide target database (optional)
        const targetDb = this._resolveTargetDatabase(entry);

        // Reuse existing model if already compiled on the chosen connection
        const connForModel = targetDb ? baseConn.useDb(String(targetDb), { useCache: true }) : baseConn;
        if (connForModel.models?.[this.modelName]) {
            this._model = connForModel.models[this.modelName];
            return this._model;
        }

        // Register model; respect explicit collection if schema options didn't set one
        this._model = (collection && !schema?.options?.collection)
            ? connForModel.model(this.modelName, schema, collection)
            : connForModel.model(this.modelName, schema);

        return this._model;
    }

    _resolveTargetDatabase(entryFromRegistry) {
        // precedence: instance option → static on repo class → modelSchemas entry → undefined
        return this._dbName
            ?? this.constructor.dbName
            ?? entryFromRegistry?.database
            ?? undefined;
    }

    /** @returns {import('mongoose').Model} */
    get Model() {
        if (!this._model) throw new Error(`[${this.name}] model not initialized. Call await ensureModel() first.`);
        return this._model;
    }

    // -------- Convenience CRUD helpers (opt-in; lean defaults where applicable) --------

    /**
     * Create a document.
     * @param {object} data
     * @param {object} [opts]
     * @returns {Promise<object>} created mongoose document
     */
    async create(data, opts) {
        await this.ensureModel();
        try {
            return await this.Model.create([data], opts).then(res => res[0]);
        } catch (err) {
            this.logger.error?.(`[${this.name}] create error: ${err.message}`, { err });
            throw err;
        }
    }

    /**
     * Find by id (lean by default).
     * @param {string} id
     * @param {object} [opts]
     * @returns {Promise<object|null>}
     */
    async findById(id, opts = { lean: true }) {
        await this.ensureModel();
        try {
            const q = this.Model.findById(id);
            return opts?.lean ? q.lean() : q;
        } catch (err) {
            this.logger.error?.(`[${this.name}] findById error: ${err.message}`, { err });
            throw err;
        }
    }

    /**
     * Find one.
     * @param {object} filter
     * @param {object} [projection]
     * @param {object} [options]
     * @param {boolean} [lean=true]
     * @returns {Promise<object|null>}
     */
    async findOne(filter, projection, options, lean = true) {
        await this.ensureModel();
        try {
            const q = this.Model.findOne(filter, projection, options);
            return lean ? q.lean() : q;
        } catch (err) {
            this.logger.error?.(`[${this.name}] findOne error: ${err.message}`, { err });
            throw err;
        }
    }

    /**
     * Find many.
     * @param {object} filter
     * @param {object} [projection]
     * @param {object} [options]
     * @param {boolean} [lean=true]
     * @returns {Promise<object[]>}
     */
    async find(filter, projection, options, lean = true) {
        await this.ensureModel();
        try {
            const q = this.Model.find(filter, projection, options);
            return lean ? q.lean() : q;
        } catch (err) {
            this.logger.error?.(`[${this.name}] find error: ${err.message}`, { err });
            throw err;
        }
    }

    /**
     * Update by id.
     * @param {string} id
     * @param {object} update
     * @param {object} [options]
     * @returns {Promise<object|null>} updated doc (lean)
     */
    async updateById(id, update, options = { new: true }) {
        await this.ensureModel();
        try {
            return await this.Model.findByIdAndUpdate(id, update, { ...options }).lean();
        } catch (err) {
            this.logger.error?.(`[${this.name}] updateById error: ${err.message}`, { err });
            throw err;
        }
    }

    /**
     * Update one (generic).
     * @param {object} filter
     * @param {object} update
     * @param {object} [options]
     * @returns {Promise<{matchedCount:number,modifiedCount:number,upsertedId?:string}>}
     */
    async updateOne(filter, update, options = {}) {
        await this.ensureModel();
        try {
            const res = await this.Model.updateOne(filter, update, options);
            return { matchedCount: res.matchedCount ?? res.n ?? 0, modifiedCount: res.modifiedCount ?? res.nModified ?? 0, upsertedId: res.upsertedId };
        } catch (err) {
            this.logger.error?.(`[${this.name}] updateOne error: ${err.message}`, { err });
            throw err;
        }
    }

    /**
     * Delete by id.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteById(id) {
        await this.ensureModel();
        try {
            const res = await this.Model.findByIdAndDelete(id);
            return !!res;
        } catch (err) {
            this.logger.error?.(`[${this.name}] deleteById error: ${err.message}`, { err });
            throw err;
        }
    }

    /**
     * Ensure indexes for this repository's model (or for all models on the connection).
     * @param {boolean} [allOnConnection=false]
     * @returns {Promise<number>} number of models processed
     */
    async ensureIndexes(allOnConnection = false) {
        const conn = this.constructor.getConnection(this.connectionName);
        if (!conn) throw new Error(`[${this.name}] connection "${this.connectionName}" not configured`);
        if (allOnConnection) {
            const list = Object.values(conn.models);
            await Promise.all(list.map(m => m.syncIndexes()));
            return list.length;
        }
        await this.ensureModel();
        await this.Model.syncIndexes();
        return 1;
    }

    /**
     * Run a transaction on this repository's connection.
     * @template T
     * @param {(ctx:{session:any, connection:any})=>Promise<T>} handler
     * @param {{maxRetry?:number}} [opts]
     * @returns {Promise<T>}
     */
    async withTransaction(handler, { maxRetry = 1 } = {}) {
        const conn = this.constructor.getConnection(this.connectionName);
        if (!conn) throw new Error(`[${this.name}] connection "${this.connectionName}" not configured`);
        const session = await conn.startSession();
        try {
            let attempts = 0;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                attempts++;
                try {
                    let result;
                    await session.withTransaction(async () => {
                        // Ensure model first so operations inside handler can use it
                        await this.ensureModel();
                        result = await handler({ session, connection: conn });
                    });
                    return result;
                } catch (err) {
                    const transient = err?.errorLabels?.includes?.('TransientTransactionError');
                    if (transient && attempts <= maxRetry) continue;
                    throw err;
                }
            }
        } finally {
            await session.endSession();
        }
    }

    /**
     * Simple cache-aside helper scoped to this repository (adapter must be injected by caller).
     * @param {{key:string, ttl?:number, loader:Function, cache?:{get:Function,set:Function,del?:Function}}} p
     * @returns {Promise<any>}
     */
    async getOrLoad({ key, ttl, loader, cache }) {
        if (!key || !loader) throw new Error(`[${this.name}] getOrLoad requires { key, loader }`);
        if (!cache) return loader();
        try {
            const hit = await cache.get(key);
            if (hit !== undefined && hit !== null) return hit;
        } catch (err) {
            this.logger.warn?.(`[${this.name}] cache get failed: ${err.message}`);
        }
        const value = await loader();
        if (ttl && value !== undefined) {
            try { await cache.set(key, value, { ttl }); } catch { /* ignore */ }
        }
        return value;
    }
}

module.exports = BaseMongoRepository;
