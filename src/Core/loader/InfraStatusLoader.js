// src/core/loader/InfraStatusLoader.js
'use strict';

const path = require('node:path');

/**
 * Loads InfraStatus.
 * @param {object} logger - Logger instance.
 * @returns {object|null} - InfraStatus instance or null.
 */
function loadInfraStatus(logger) {
    try {
        const InfraStatus = require(path.join(__dirname, '../infra/InfraStatus.js'));
        const infra = new InfraStatus();
        logger.info?.('[InfraStatus] initialized');
        return infra;
    } catch (e) {
        logger.error?.(`[InfraStatus] failed to initialize: ${e?.message}`);
        return null;
    }
}

module.exports = { loadInfraStatus };
