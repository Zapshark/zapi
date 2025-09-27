// src/core/loader/HealthServiceLoader.js
'use strict';

const path = require('node:path');

/**
 * Loads and starts HealthService.
 * @param {object} logger - Logger instance.
 * @returns {Promise<object|null>} - HealthService instance or null.
 */
async function loadHealthService(logger) {
    try {
        const HealthService = require(path.join(__dirname, '../system/HealthService.js'));
        const health = new HealthService();
        await health.start?.();
        logger.info?.('[HealthService] started');
        return health;
    } catch (e) {
        logger.error?.(`[HealthService] failed to start: ${e?.message}`);
        return null;
    }
}

module.exports = { loadHealthService };
