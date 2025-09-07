'use strict';
const os = require('os');
const path = require('path');

const { createHttpServer, launchCluster } = require('..'); // from src/index.js
const EnvLoader = require('../Core/EnvLoader');
const ZapiFramework = require('../Core/ZapiFramework');

/**
 * Starts ZAPI in clustered or single mode based on:
 *  - ENV (CLUSTER / ZAPI_CLUSTER, INSTANCES / WORKERS)
 *  - or Config entry "Cluster" from your registry
 *
 * Order of precedence: ENV > Config > single-process.
 */
async function AppCluster({ appRoot, port, log = console } = {}) {
    appRoot = appRoot || path.resolve(process.cwd());

    // 1) Load .env so flags can come from dotenv
    try { EnvLoader.load({ appDir: appRoot, silent: false, override: false }); }
    catch (e) { log?.warn?.(`[AppCluster] Env load warning: ${e.message}`); }

    const PORT = Number(port || process.env.PORT || 3000);

    // 2) ENV intent
    const envFlag = String(process.env.CLUSTER || process.env.ZAPI_CLUSTER || '').toLowerCase();
    const envWantsCluster = ['1', 'true', 'yes', 'on'].includes(envFlag);
    const envInstances = Number(process.env.INSTANCES || process.env.WORKERS || 0);

    // 3) Config intent (read registry **without** starting HTTP)
    const fw = new ZapiFramework({ config: {}, log });
    fw.loadAppConfig(appRoot); // populates the config registry you can also view at /backend/config during runtime. :contentReference[oaicite:1]{index=1}
    const raw = fw.resolve('config', 'Cluster');                  // supports { Cluster:{...} } or flat
    const cfg = raw?.Cluster || raw || {};
    const cfgWantsCluster = !!cfg.enabled;

    // 4) Final decision
    const shouldCluster = envWantsCluster || cfgWantsCluster;

    // 5) Worker count
    const workers =
        (Number.isFinite(envInstances) && envInstances > 0) ? envInstances :
            (Number.isFinite(cfg.workers)   && cfg.workers   > 0) ? cfg.workers :
                (os.cpus()?.length || 1);

    // 6) The server runner used by workers
    async function createServer() {
        return createHttpServer({ appRoot, port: PORT, log });
    }

    if (shouldCluster) {
        return launchCluster({
            createServer,
            workers,
            respawn: cfg.respawn !== false, // default true
            log
        });
    } else {
        return createServer();
    }
}

module.exports = { AppCluster };
