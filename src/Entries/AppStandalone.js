'use strict';
const path = require('path');
const { createHttpServer } = require('..');           // from src/index.js (package entry)
const EnvLoader = require('../Core/EnvLoader');

/**
 * Starts a single-process ZAPI HTTP/WS server.
 * Loads .env first so PORT and other env vars are available.
 */
async function AppStandalone({ appRoot, port, log = console } = {}) {
    appRoot = appRoot || path.resolve(process.cwd());
    try { EnvLoader.load({ appDir: appRoot, silent: false, override: false }); }
    catch (e) { log?.warn?.(`[AppStandalone] Env load warning: ${e.message}`); }

    const PORT = Number(port || process.env.PORT || 3000);
    return createHttpServer({ appRoot, port: PORT, log });
}

module.exports = { AppStandalone };
