// src/core/loader/OutageDeduperLoader.js
'use strict';

const path = require('node:path');

/**
 * Loads OutageDeduper.
 * @param {object} logger - Logger instance.
 * @returns {object|null} - OutageDeduper instance or null.
 */
function loadOutageDeduper(logger) {
    try {
        const OutageDeduper = require(path.join(__dirname, '../infra/OutageDeduper.js'));
        const deduper = new OutageDeduper();
        logger.info?.('[OutageDeduper] initialized');
        return deduper;
    } catch (e) {
        logger.error?.(`[OutageDeduper] failed to initialize: ${e?.message}`);
        return null;
    }
}

module.exports = { loadOutageDeduper };
