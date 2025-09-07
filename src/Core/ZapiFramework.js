'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { EventEmitter } = require('events'); // ⬅️ NEW
const BackendManagement = require('./BackendManagement');
const RedisCache = require('./RedisCache');
const { registerCacheKey } = require('./CacheKeyRegistry');
const Logger = require('./Logger');


/**
 * ZapiFramework (a.k.a. ZapiServer/ZapiFoundation role)
 * - Single orchestrator for registries, discovery, lifecycle, event bus, and HTTP.
 */
class ZapiFramework {
    constructor({ config = {}, log} = {}) {
        this.log = log || new Logger(this);
        this.config = config;
        this.cache = null; // Delay RedisCache initialization

        this.registries = new Map();           // kind -> Map(name, instance)
        this.singletons = new Map();           // 'db','cache','env','logger', etc.
        this.lifecycle = { init: [], start: [], stop: [] };
        this._mounted = false;

        // --- Event bus (NEW) ---
        this.events = new EventEmitter();
        this.events.setMaxListeners(this.config.maxListeners || 100);

        // --- HTTP handles for graceful shutdown (NEW) ---
        this._app = null;
        this._server = null;
        this._shuttingDown = false;


    }

    // --- DI / Singletons ---
    set(key, value) { this.singletons.set(key, value); return this; }
    get(key) { return this.singletons.get(key); }

    // --- Event bus API (NEW) ---
    on(evt, listener)  { this.events.on(evt, listener);  return () => this.off(evt, listener); }
    once(evt, listener){ this.events.once(evt, listener); return () => this.off(evt, listener); }
    off(evt, listener) { this.events.off(evt, listener); }
    emit(evt, ...args) { this.events.emit(evt, ...args); }
    async emitAsync(evt, ...args) {
        const listeners = this.events.listeners(evt);
        await Promise.allSettled(listeners.map(fn => Promise.resolve().then(() => fn(...args))));
    }

    // --- Registries ---
    _bucket(kind) {
        if (!this.registries.has(kind)) this.registries.set(kind, new Map());
        return this.registries.get(kind);
    }
    register(kind, name, instance) {
        const bucket = this._bucket(kind);
        if (bucket.has(name)) this.log.warn(`[Zapi] Overwriting ${kind}:${name}`);
        bucket.set(name, instance);
        this.emit('registry:registered', { kind, name, instance }); // 🔔 NEW
        return instance;
    }
    resolve(kind, name) { return this._bucket(kind).get(name); }
    all(kind) { return Array.from(this._bucket(kind).values()); }
    has(kind, name) { return this._bucket(kind).has(name); }

    // --- Lifecycle ---
    onLifecycle(stage, fn) { this.lifecycle[stage]?.push(fn); return () => {
        const arr = this.lifecycle[stage]; const i = arr.indexOf(fn); if (i>=0) arr.splice(i,1);
    };}

    on(stage, fn) { // keep legacy calls working if someone did framework.on('init', ...)
        if (['init','start','stop'].includes(stage)) return this.onLifecycle(stage, fn);
        return this.events.on(stage, fn);
    }

    async _run(stage) {
        this.emit(`lifecycle:${stage}:before`);
        for (const hook of this.lifecycle[stage]) await hook();
        for (const m of this.all('module')) {
            if (typeof m[stage] === 'function') await m[stage]();
        }
        this.emit(`lifecycle:${stage}:after`);
    }
    async init()  { await this._run('init'); }
    async start() { await this._run('start'); }
    async stop()  { await this._run('stop'); }

    // --- Discovery ---
    /**
     * Discover modules and controllers under: <appRoot>/App/Modules/<Name>
     * - optional class file: Module.js (extends BaseModule) -> auto-registers
     * - controllers:
     *    - index.js or controller.js  (factory: (framework) => Router)
     *    - Controllers/*.js           (each exports factory or BaseController subclass)
     */
    discover(appRoot) {
        const modulesDir = path.join(appRoot, 'App', 'Modules');
        if (!fs.existsSync(modulesDir)) { this.log.warn(`[Zapi] No Modules at ${modulesDir}`); return; }

        for (const modName of fs.readdirSync(modulesDir)) {
            const modPath = path.join(modulesDir, modName);
            if (!fs.statSync(modPath).isDirectory()) continue;

            // NEW: construct Module.js (auto-registers via BaseArtifact)
            const moduleClassPath = path.join(modPath, 'Module.js');
            if (fs.existsSync(moduleClassPath)) {
                const ModuleClass = require(moduleClassPath);
                // eslint-disable-next-line no-new
                new ModuleClass({ framework: this, name: modName });
            }

            // Controllers
            const factories = [];
            for (const fname of ['index.js', 'controller.js']) {
                const p = path.join(modPath, fname);
                if (fs.existsSync(p)) { factories.push({ base: '', factory: require(p) }); break; }
            }
            const controllersDir = path.join(modPath, 'Controllers');
            if (fs.existsSync(controllersDir)) {
                for (const file of fs.readdirSync(controllersDir)) {
                    if (file.endsWith('.js')) {
                        factories.push({ base: file.replace(/\.js$/,'').toLowerCase(), factory: require(path.join(controllersDir, file)) });
                    }
                }
            }
            if (factories.length) this.register('controllerFactories', modName, factories);
            this.emit('discover:done', { modules: Array.from((this.registries.get('controllerFactories')||new Map()).keys()) });
        }
    }

    initializeCache() {
        const redisConfig = this.resolve('config', 'Redis')?.Redis || this.resolve('config', 'Redis');

        if (redisConfig?.enabled) {
            this.cache = new RedisCache(redisConfig, this.log);
            this.cache.connect().catch((err) => {
                this.log.error(`[Redis] Failed to connect: ${err.message}`);
            });
        } else {
            this.log.warn('[Redis] Redis is disabled in the configuration.');
        }
    }


    /**
     * Load module configurations and register CacheKeys.
     * @param {string} appRoot - The application root directory.
     */
    loadModuleConfigs(appRoot) {
        const modulesDir = path.join(appRoot, 'App', 'Modules');
        if (!fs.existsSync(modulesDir)) return;

        const modules = fs.readdirSync(modulesDir).filter((d) =>
            fs.statSync(path.join(modulesDir, d)).isDirectory()
        );

        for (const modName of modules) {
            const configPath = path.join(modulesDir, modName, 'Config', modName+'.config.js');
            if (!fs.existsSync(configPath)) continue;

            try {
                const config = require(configPath);
                if (config.CacheKeys && Array.isArray(config.CacheKeys)) {
                    for (const def of config.CacheKeys) {
                        registerCacheKey(this, def.name, def);
                    }
                    this.log.info?.(`[ZapiFramework] Registered ${config.CacheKeys.length} CacheKeys for module: ${modName}`);
                }
            } catch (err) {
                this.log.warn?.(`[ZapiFramework] Failed to load config for module ${modName}: ${err.message}`);
            }
        }
    }

    /**
     * Load config files and register each as its own entry in the 'config' registry.
     * Keys are derived from filenames (Zapi.js -> 'Zapi', MongoDB.js -> 'MongoDB').
     * If dev.Zapi.js is present, only 'dev.*.js' files are loaded and 'dev.' is stripped.
     * @param {string} appRoot
     */
    loadAppConfig(appRoot) {
        const ConfigLoader = require('./ConfigLoader');
        const { entries, devMode, loadedFiles, dir } = ConfigLoader.load({ appRoot, log: this.log });

        for (const [key, obj] of entries.entries()) {
            this.register('config', key, obj);

        }

        this.set('configMeta', { devMode, loadedFiles, dir });
        this.log.info?.(
            `[Config] ${devMode ? 'DEV' : 'PROD'} mode • registered ${entries.size} config entr${entries.size === 1 ? 'y' : 'ies'} from ${dir}`
        );
        this.log.debug?.(`[Zapi] Loaded configurations: ${JSON.stringify([...entries.keys()])}`);

    }
    normalizePath(path) {
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        if (path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        return path;
    }

    /**
     * Create and mount an Express server with discovered controllers.
     * Returns the http.Server instance.
     */
    async createHttpServer({ appRoot, port = process.env.PORT || 3000 } = {}) {
        if (!appRoot) throw new Error('createHttpServer({ appRoot }) required');

        // 1) Load config, models, ws-handlers, middleware
        this.loadAppConfig(appRoot);
        this.log = new Logger(this.resolve('config', 'Logger')?.Logger) || {}; // reconfigure logger after config load
        this._attachSignalHandlers(); // graceful shutdown
        const backendEnabled = this._resolveBackendEnabled();
        const backendPath = backendEnabled ? this._resolveBackendPath() : null;
        this.log.info?.(`[Zapi] Backend management UI is ${backendEnabled ? 'ENABLED' : 'DISABLED'}${backendEnabled ? ` at ${backendPath}` : ''}`);


        this.initializeCache(); // configs
        const ModelLoader = require('./ModelLoader');
        ModelLoader.load({ framework: this, appRoot, log: this.log });                   // models

        this.loadModuleConfigs(appRoot)

        const { load: loadWsHandlers } = require('./WSHandlerLoader');
        loadWsHandlers({ framework: this, appRoot, log: this.log });                     // ws handlers

        const MiddlewareLoader = require('./MiddlewareLoader');
        MiddlewareLoader.load({ framework: this, appRoot, log: this.log });              // middleware

        //const CacheKeyLoader = require('./CacheKeyLoader');
        //CacheKeyLoader.load({ framework: this, appRoot, log: this.log });

        // 2) Discover controllers (declares controllerFactories in the registry)
        this.discover(appRoot);

        // 3) Init + Start lifecycle
        await this.init();
        await this.start();

        // 4) Ensure Redis connects (safe no-op if disabled)
        if (this.cache?.connect) {
            await this.cache.connect();
        }

        // 5) Express app
        const express = require('express');
        const app = express();
        this._app = app;
        const rootPath = this.normalizePath(this.resolve('config', 'Zapi')?.rootPath) || '/api'; // Default to '/api'
        app.use(express.json());

        // 5a) Apply PRE auto-middleware in priority order
        {
            const bucket = this.registries.get('middleware') || new Map();
            const pre = Array.from(bucket.values())
                .filter(m => m.auto && m.stage === 'pre')
                .sort((a, b) => a.priority - b.priority);
            for (const m of pre) {
                app.use(m.handler);
                this.log.info?.(`[MW] applied(pre) ${m.name}`);
            }
        }

        // 5b) Backend management UI/API (always available at /backend)
        const BackendManagement = require('./BackendManagement');
        const backend = new BackendManagement({ framework: this });
        app.use('/backend', backend.getRouter());

        // 6) Mount controllers and collect OpenAPI metadata
        const { getAttached } = require('./RouteDSL');
        const openapiRoutes = [];

        const modFactories = this.registries.get('controllerFactories') || new Map();
        for (const [modName, factories] of modFactories.entries()) {
            const basePath = `${rootPath}/${modName.toLowerCase()}`;
            for (const { base, factory } of factories) {
                const out = factory(this); // controller factory(framework) -> Router or {getRouter}
                const router = (out && typeof out.getRouter === 'function') ? out.getRouter() : out;
                if (!router) {
                    this.log.warn(`[Zapi] Invalid controller in ${modName}`);
                    this.emit('controller:invalid', { module: modName, base });
                    continue;
                }
                const mount = base ? `${basePath}/${base}` : basePath;
                app.use(mount, router);
                this.log.info?.(`[HTTP] Mounted ${mount}`);
                this.emit('controller:mounted', { module: modName, mount });

                // harvest DSL metadata (if the controller used RouteDSL.attach)
                const defs = getAttached(router);
                if (defs && defs.length) {
                    for (const d of defs) {
                        openapiRoutes.push({
                            ...d,
                            path: `${mount}${d.path}`.replace(/\/+$/, '')
                        });
                    }
                }
            }
        }

        // 7) POST auto-middleware (runs after controllers)
        {
            const bucket = this.registries.get('middleware') || new Map();
            const post = Array.from(bucket.values())
                .filter(m => m.auto && m.stage === 'post')
                .sort((a, b) => a.priority - b.priority);
            for (const m of post) {
                app.use(m.handler);
                this.log.info?.(`[MW] applied(post) ${m.name}`);
            }
        }

        // 8) Health + root
        app.get('/health', (_req, res) => res.json({ ok: true, name: this.config?.name || 'ZapiApp' }));
        app.get('/', (_req, res) => res.type('text').send('ZAPI running. Try /health, /backend, or /api/<module>'));

        // 9) Live OpenAPI (built from collected DSL routes)
        app.get('/openapi.json', (_req, res) => {
            try {
                const { buildOpenAPI } = require('./OpenAPI');
                const zapi = this.resolve('config', 'Zapi') || {};
                const info = {
                    title: zapi.name || 'ZAPI',
                    version: zapi.version || '0.1.0',
                    description: zapi.description || 'ZAPI auto-generated OpenAPI'
                };
                const servers = [{ url: zapi.baseUrl || '/' }];
                const doc = buildOpenAPI({ info, servers, routes: openapiRoutes });
                res.json(doc);
            } catch (err) {
                this.log.error?.('[OpenAPI] build failed:', err);
                res.status(500).json({ error: 'OpenAPI generation failed' });
            }
        });

        // 10) Start HTTP server
        const server = app.listen(port, () => {
            this.log.info?.(`[HTTP] http://localhost:${port}`);
            this.emit('server:listening', { port });
        });
        this._server = server;

        const rawWs = this.resolve('config', 'WebSocket');
        const wsCfg = rawWs?.WebSocket || rawWs;



        if (wsCfg?.enabled) {
            const WebSocketHub = require('./WebSocketHub');
            this.ws = new WebSocketHub({
                server,
                framework: this,
                path: wsCfg.path || '/ws',
                heartbeatMs: Number(wsCfg.heartbeatMs || 30000),
                log: this.log,
            });
        }


        this._mounted = true;
        return server;
    }




    _randomPath() {
        const r = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
        return `/_bm-${r.slice(0, 32)}`;
    }

    _resolveBackendEnabled() {
        const zapiCfg = this.resolve('config', 'Zapi') || {};
        const explicit = zapiCfg.backend?.enabled;
        if (explicit === undefined) return true; // default ON
        const s = String(explicit).trim().toLowerCase();
        return explicit === true || s === '1' || s === 'true' || s === 'yes' || s === 'y';
    }

    _resolveBackendPath() {
        const zapiCfg = this.resolve('config', 'Zapi') || {};
        const explicit = zapiCfg.backendPath || zapiCfg.backend?.path;
        return explicit && String(explicit).trim() ? String(explicit).trim() : this._randomPath();
    }



    _attachSignalHandlers() {
        const timeoutMs = this.config.shutdownTimeout || 10000;
        const handle = async (signal) => {
            if (this._shuttingDown) return;
            this._shuttingDown = true;
            this.log.info(`[Zapi] Received ${signal}. Beginning graceful shutdown...`);
            this.emit('shutdown:begin', { signal });

            try {
                await this.stop();
            } catch (e) {
                this.log.error('[Zapi] Error during lifecycle stop:', e);
                this.emit('shutdown:error', e);
            }

            const timer = setTimeout(() => {
                this.log.warn(`[Zapi] Force exiting after ${timeoutMs}ms`);
                this.emit('shutdown:timeout', { timeoutMs });
                process.exit(1);
            }, timeoutMs).unref?.();

            if (this._server) {
                this._server.close(() => {
                    clearTimeout(timer);
                    this.emit('shutdown:closed');
                    this.log.info('[Zapi] HTTP server closed.');
                    process.exit(0);
                });
            } else {
                clearTimeout(timer);
                this.emit('shutdown:closed');
                process.exit(0);
            }
        };

        process.on('SIGINT', handle);
        process.on('SIGTERM', handle);
        this.emit('shutdown:handlers:attached');
    }


    // In src/Core/ZapiFramework.js, inside class ZapiFramework { ... }

// Return a registered middleware by name (optionally clone or wrap if needed)
    getMiddleware(name) {
        const entry = this.resolve('middleware', name);
        if (!entry) return null;
        return entry.handler;
    }

// Sugary alias so controllers can do framework.middleware('auth')
    middleware(name) { return this.getMiddleware(name); }


    /**
     * Discover and register App model schemas into the 'modelSchemas' registry.
     * Supports single or multiple MongoDB connections as described in ModelLoader.
     * @param {string} appRoot
     */
    loadAppModels(appRoot) {
        const ModelLoader = require('./ModelLoader');
        const meta = ModelLoader.load({ framework: this, appRoot, log: this.log });
        this.set('modelMeta', meta);
    }


    /**
     * Programmatic shutdown (e.g., from tests).
     * @param {{timeoutMs?:number, code?:number}} opts
     */
    async shutdown(opts = {}) {
        const timeoutMs = opts.timeoutMs ?? this.config.shutdownTimeout ?? 10000;
        if (this._shuttingDown) return;
        this._shuttingDown = true;

        this.emit('shutdown:begin', { signal: 'programmatic' });
        try { await this.stop(); } catch (e) {
            this.log.error('[Zapi] Error during lifecycle stop:', e);
            this.emit('shutdown:error', e);
        }

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.emit('shutdown:timeout', { timeoutMs });
                reject(new Error('Shutdown timeout'));
            }, timeoutMs).unref?.();

            if (this._server) {
                this._server.close(() => { clearTimeout(timer); this.emit('shutdown:closed'); resolve(); });
            } else {
                clearTimeout(timer); this.emit('shutdown:closed'); resolve();
            }
        });

        if (typeof opts.code === 'number') process.exit(opts.code);
    }
}

module.exports = ZapiFramework;
