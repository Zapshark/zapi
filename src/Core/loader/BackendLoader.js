// src/core/loader/BackendLoader.js
'use strict';

const path = require('node:path');

/**
 * Loads and mounts backend services (auth, router, state) if enabled in config.
 * @param {object} app - Express app instance.
 * @param {object} config - App config object.
 * @param {object} logger - Logger instance.
 * @param {object} [eventServer] - Optional event server for publishing events.
 * @returns {Promise<void>}
 */
async function loadBackend(app, config, logger, eventServer) {
    const backendCfg = config?.zapi?.apiBackend || {};
    const enabled = !!backendCfg.enabled;
    const basePath = (backendCfg.basePath || '/_zapi').replace(/\/+$/, '') || '/_zapi';

    if (!enabled) {
        logger.info?.('[backend] disabled by config');
        return;
    }

    try {
        // State service
        const BackendStateService = require(path.join(__dirname, '../backend/BackendStateService.js'));
        const stateSvc = new BackendStateService();
        await stateSvc.start?.();

        // Auth (optional, if present)
        let auth = null;
        try {
            const ApiBackendAuth = require(path.join(__dirname, '../backend/ApiBackendAuth.js'));
            auth = new ApiBackendAuth(config);
            await auth.init?.();
            logger.info?.('[backend] auth initialized');
        } catch (e) {
            logger.warn?.('[backend] auth not initialized:', e?.message);
        }

        // Router
        const { buildRouter: buildBackend } = require(path.join(__dirname, '../backend/ApiBackendRouter.js'));
        app.use(basePath, buildBackend(config, { auth, stateSvc }));
        logger.info?.(`[backend] mounted at ${basePath}`);

        // Event notification
        if (eventServer?.publish) {
            await eventServer.publish('zapi:sys:backend:ready', { basePath });
        }
    } catch (e) {
        logger.error?.(`[backend] failed to mount: ${e?.message}`);
    }
}

module.exports = { loadBackend };
