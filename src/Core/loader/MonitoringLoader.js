// src/core/loader/MonitoringLoader.js
'use strict';

const path = require('node:path');

/**
 * Loads and starts the monitoring service if enabled in config.
 * @param {object} config - App config object.
 * @param {object} logger - Logger instance.
 * @param {object} [eventServer] - Optional event server for publishing events.
 * @returns {Promise<object|null>} - MonitoringService instance or null.
 */
async function loadMonitoring(config, logger, eventServer) {
    const monCfg = config?.monitoring || {};
    if (!monCfg.enabled) {
        logger.info?.('[monitoring] disabled by config');
        return null;
    }

    try {
        const MonitoringService = require(path.join(__dirname, '../monitoring/MonitoringService.js'));
        const monitoring = new MonitoringService(monCfg);
        await monitoring.start?.();
        logger.info?.('[monitoring] service started');

        if (eventServer?.publish) {
            await eventServer.publish('zapi:sys:monitoring:ready', { enabled: true });
        }

        return monitoring;
    } catch (e) {
        logger.error?.(`[monitoring] failed to start: ${e?.message}`);
        return null;
    }
}

module.exports = { loadMonitoring };
