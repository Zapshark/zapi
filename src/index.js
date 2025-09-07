'use strict';

const ZapiFramework = require('./Core/ZapiFramework');
const BaseArtifact = require('./Core/BaseArtifact');
const BaseModule = require('./Core/BaseModule');
const BaseService = require('./Core/BaseService');
const BaseRepository = require('./Core/BaseRepository');
const BaseModel = require('./Core/BaseModel');
const BaseController = require('./Core/BaseController');
const BaseMongoRepository = require('./Core/BaseMongoRepository');
const ClusterLauncher = require('./Core/ClusterLauncher');
const { launchCluster } = require('./Core/ClusterLauncher');
const EnvLoader = require('./Core/EnvLoader'); // correct case
const Logger = require('./Core/Logger'); // correct case
const ZLog = new Logger(); // alias for backward compatibility

// Expose Logger class for custom transports



// Cache key helpers
const CacheKeyRegistry = require('./Core/CacheKeyRegistry');
const { getCacheKey, buildKey } = CacheKeyRegistry;

// Route DSL + OpenAPI
const RouteDSL = require('./Core/RouteDSL');
const { attach, GET, POST, PUT, PATCH, DELETE, getAttached } = RouteDSL;
const { buildOpenAPI } = require('./Core/OpenAPI');

// Named-middleware helper
function mw(framework, name /*, ...args later if you add parametrized variants */) {
    const fn = framework.getMiddleware?.(name);
    if (!fn) throw new Error(`[zapi] middleware "${name}" not found`);
    return fn;
}



        /**
 * Convenience helper so apps can do:
 *   const { createHttpServer } = require('zapi');
 */
async function createHttpServer({
                                    appRoot,
                                    config = {},
                                    log = ZLog,
                                    port,
                                    envPath,
                                    envOverride = false,
                                    envSilent = false
                                } = {}) {
    if (!appRoot) throw new Error('createHttpServer({ appRoot }) required');

    const effectiveEnvPath = envPath ?? config.envPath;
    try {
        EnvLoader.load({
            appDir: appRoot,
            envPath: effectiveEnvPath,
            override: Boolean(envOverride || config.envOverride),
            silent: Boolean(envSilent || config.envSilent),
        });
    } catch (e) {
        log?.warn?.(`[zapi] Env load warning: ${e.message}`);
    }

    const framework = new ZapiFramework({ config, ZLog });
    return framework.createHttpServer({ appRoot, port });
}

module.exports = {
    ZLog,
    Logger,
    // Orchestrator
    ZapiFramework,
    // Base classes
    BaseArtifact,
    BaseModule,
    BaseService,
    BaseRepository,
    BaseModel,
    BaseController,
    BaseMongoRepository,
    // Helpers
    createHttpServer,
    // Middleware helper
    mw,
    // Route DSL exports
    RouteDSL,
    attach, GET, POST, PUT, PATCH, DELETE, getAttached,
    // OpenAPI builder
    buildOpenAPI,
    // Cache key registry + top-level helpers
    CacheKeyRegistry,
    ClusterLauncher,
    launchCluster,
    getCacheKey,
    buildKey,
};
// entries
module.exports.AppStandalone = require('./Entries/AppStandalone').AppStandalone;
module.exports.AppCluster    = require('./Entries/AppCluster').AppCluster;
module.exports.Logger = Logger;
module.exports.ZLog = ZLog;
