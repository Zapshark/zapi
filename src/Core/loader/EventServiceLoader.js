// src/core/loader/EventServiceLoader.js
'use strict';

const path = require('node:path');

/**
 * Loads and starts event services if enabled in config.
 * @param {object} config - App config object.
 * @param {object} logger - Logger instance.
 * @param {object} [eventServer] - Optional event server for publishing events.
 * @returns {Promise<object|null>} - { eventServer, systemEventService, wsEventService } or null.
 */
async function loadEventServices(config, logger, eventServer) {
    const eventCfg = config?.events || {};
    if (!eventCfg.enabled) {
        logger.info?.('[events] disabled by config');
        return null;
    }

    try {
        // EventServer
        const EventServer = require(path.join(__dirname, '../events/EventServer.js'));
        const eventSrv = new EventServer(eventCfg);
        await eventSrv.start?.();
        logger.info?.('[events] EventServer started');

        // SystemEventService
        const SystemEventService = require(path.join(__dirname, '../events/SystemEventService.js'));
        const sysEventSvc = new SystemEventService(eventSrv);
        await sysEventSvc.start?.();
        logger.info?.('[events] SystemEventService started');

        // WsEventService (optional)
        let wsEventSvc = null;
        if (eventCfg.wsEnabled) {
            try {
                const WsEventService = require(path.join(__dirname, '../events/WsEventService.js'));
                wsEventSvc = new WsEventService(eventSrv);
                await wsEventSvc.start?.();
                logger.info?.('[events] WsEventService started');
            } catch (e) {
                logger.warn?.('[events] WsEventService not started:', e?.message);
            }
        }

        // Publish ready event
        if (eventServer?.publish) {
            await eventServer.publish('zapi:sys:events:ready', { enabled: true });
        }

        return { eventServer: eventSrv, systemEventService: sysEventSvc, wsEventService: wsEventSvc };
    } catch (e) {
        logger.error?.(`[events] failed to start: ${e?.message}`);
        return null;
    }
}

module.exports = { loadEventServices };
