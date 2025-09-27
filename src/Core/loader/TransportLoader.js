// src/core/loader/TransportLoader.js
'use strict';

const path = require('node:path');

/**
 * Loads and initializes WebSocket server if enabled in config.
 * @param {object} config - App config object.
 * @param {object} logger - Logger instance.
 * @returns {object|null} - WebSocket server instance or null.
 */
function loadWebSocketServer(config, logger) {
    if (!config?.websocket?.enabled) {
        logger.info?.('WebSocket server not enabled by config.');
        return null;
    }
    try {
        const WebSocketServer = require(path.join(__dirname, '../../ws/WebSocketServer.js'));
        const wsServer = new WebSocketServer(config.websocket);
        logger.info?.('WebSocket server initialized.');
        return wsServer;
    } catch (e) {
        logger.error?.(`WebSocket server setup failed: ${e?.message}`);
        return null;
    }
}

/**
 * Loads and initializes MessageBus if enabled in config.
 * @param {object} config - App config object.
 * @param {object} logger - Logger instance.
 * @returns {object|null} - MessageBus instance or null.
 */
function loadMessageBus(config, logger) {
    if (!config?.messageBus?.enabled) {
        logger.info?.('MessageBus not enabled by config.');
        return null;
    }
    try {
        const MessageBus = require(path.join(__dirname, '../../ws/MessageBus.js'));
        const bus = new MessageBus(config.messageBus);
        logger.info?.('MessageBus initialized.');
        return bus;
    } catch (e) {
        logger.error?.(`MessageBus setup failed: ${e?.message}`);
        return null;
    }
}

/**
 * Loads and initializes Redis event service if enabled in config.
 * @param {object} config - App config object.
 * @param {object} logger - Logger instance.
 * @returns {object|null} - RedisEventService instance or null.
 */
function loadRedisEventService(config, logger) {
    if (!config?.redis?.enabled) {
        logger.info?.('Redis event service not enabled by config.');
        return null;
    }
    try {
        const RedisEventService = require(path.join(__dirname, '../../core/events/RedisEventService.js'));
        const redisService = new RedisEventService(config.redis);
        logger.info?.('Redis event service initialized.');
        return redisService;
    } catch (e) {
        logger.error?.(`Redis event service setup failed: ${e?.message}`);
        return null;
    }
}

module.exports = {
    loadWebSocketServer,
    loadMessageBus,
    loadRedisEventService
};
