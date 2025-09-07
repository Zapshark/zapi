'use strict';
const os = require('os');
const path = require('path');

// Re-exported from zapi/src/index.js
const { launchCluster } = require('zapi');
const ZapiFramework = require('./ZapiFramework');
const EnvLoader = require('./EnvLoader');

/**
 * Orchestrates clustering OUTSIDE the app entry.
 *  - Loads .env EARLY (so CLUSTER/INSTANCES can come from dotenv)
 *  - Loads ZAPI Config registry, reads "Cluster" entry
 *  - Decides whether to cluster, and how many workers to fork
 *  - Defers actual HTTP/WS startup to your app entry module (createServer)
 *
 * @param {object} p
 * @param {string} p.appRoot     Absolute app root (ExampleApp dir)
 * @param {string} p.entry       Absolute path to a module that exports async function createServer({ appRoot, port })
 * @param {number} [p.port]      Optional port override (else from process.env.PORT or default 3000)
 * @param {object} [p.log]       Logger
 */
async function runOrchestrator({ appRoot, entry, port, log = console } = {}) {
    if (!appRoot) throw new Error('[ClusterOrchestrator] appRoot required');
    if (!entry) throw new Error('[ClusterOrchestrator] entry module path required');

    // 1) Load .env first so env flags are available
    try {
        EnvLoader.load({ appDir: appRoot, silent: false, override: false });
    } catch (e) {
        log?.warn?.(`[ClusterOrchestrator] Env load warning: ${e.message}`);
    }

    const PORT = Number(port || process.env.PORT || 3000);

    // 2) Read cluster intent from ENV
    const envFlag = String(process.env.CLUSTER || process.env.ZAPI_CLUSTER || '').toLowerCase();
    const envWantsCluster = ['1', 'true', 'yes', 'on'].includes(envFlag);
    const envInstances = Number(process.env.INSTANCES || process.env.WORKERS || 0);

    // 3) Read cluster intent from Config registry (without starting HTTP)
    const fw = new ZapiFramework({ config: {}, log });
    fw.loadAppConfig(appRoot); // populate the config registry BEFORE server
    // Note: BackendManagement exposes this same config registry at /backend/config during runtime (redacted). :contentReference[oaicite:0]{index=0}
    const rawCfg = fw.resolve('config', 'Cluster'); // supports either {Cluster:{...}} or flat
    const cfg = rawCfg?.Cluster || rawCfg || {};
    const cfgWantsCluster = !!cfg.enabled;

    // 4) Final decision: ENV wins; else Config; else single-process
    const shouldCluster = envWantsCluster || cfgWantsCluster;

    // 5) Workers: ENV > Config > CPU count
    const workers =
        (Number.isFinite(envInstances) && envInstances > 0) ? envInstances :
            (Number.isFinite(cfg.workers)   && cfg.workers   > 0) ? cfg.workers :
                (os.cpus()?.length || 1);

    // 6) Create the server runner (loaded ONLY when needed)
    const requireEntry = () => {
        const mod = require(entry);
        if (typeof mod?.createServer !== 'function') {
            throw new Error(`[ClusterOrchestrator] ${path.relative(process.cwd(), entry)} must export async function createServer({ appRoot, port })`);
        }
        return mod.createServer;
    };

    if (shouldCluster) {
        const createServer = async () => {
            const start = requireEntry();
            return start({ appRoot, port: PORT, log });
        };
        await launchCluster({
            createServer,
            workers,
            respawn: cfg.respawn !== false, // default true
            log
        });
    } else {
        const start = requireEntry();
        await start({ appRoot, port: PORT, log });
    }
}

module.exports = { runOrchestrator };
