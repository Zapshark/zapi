// src/core/loader/ClusterHeartbeatLoader.js
'use strict';

const path = require('node:path');

/**
 * Loads and starts ClusterHeartbeat if bus is provided.
 * @param {object} bus - MessageBus instance (required).
 * @param {object} logger - Logger instance.
 * @returns {Promise<object|null>} - ClusterHeartbeat instance or null.
 */
async function loadClusterHeartbeat(bus, logger) {
    if (!bus) {
        logger.warn?.('[ClusterHeartbeat] bus not provided, skipping heartbeat');
        return null;
    }
    try {
        const { createClusterHeartbeat } = require(path.join(__dirname, '../system/ClusterHeartbeat.js'));
        const heartbeat = createClusterHeartbeat({ bus });
        await heartbeat.start?.();
        logger.info?.('[ClusterHeartbeat] started');
        return heartbeat;
    } catch (e) {
        logger.error?.(`[ClusterHeartbeat] failed to start: ${e?.message}`);
        return null;
    }
}

module.exports = { loadClusterHeartbeat };
