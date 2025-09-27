'use strict';

// Load and set configuration utilities
const { loadConfig, setConfig } = require('./core/Config');

// Main coordinator for managing servers, workers, and lifecycle
const { Coordinator } = require('./server/Coordinator');

// Base class for lifecycle management
const { BaseLifecycle } = require('./core/BaseLifecycle');

// Utilities for route introspection and indexing
const { describeRoutes, withRouteIndex } = require('./http/RouteIntrospect');

/**
 * Bootstraps the ZAPI application.
 * Loads configuration, initializes the coordinator, and starts all services.
 * @param {Object} customOverride - Optional config overrides
 * @returns {Object} - Coordinator instance, config, and stop function
 */
async function bootstrap(customOverride) {
    const merged = loadConfig(customOverride);
    setConfig(merged);
    const coordinator = new Coordinator(merged);
    await coordinator.init();
    await coordinator.start();
    return { coordinator, config: merged, stop: async () => { try { await coordinator.stop?.(); } catch {} } };
}

module.exports = {
    // Lifecycle management
    bootstrap,
    Coordinator,

    // Configuration and registries
    ...require('./core/Config'),
    ...require('./core/registry/services'),
    ...require('./core/registry/controllers'),
    ...require('./core/registry/middleware'),

    // Database and HTTP utilities
    ...require('./db/MongooseManager'),
    buildRouter: require('./http/Router').buildRouter,
    createCache: require('./cache/RedisCache').createCache,

    // WebSocket server and message bus
    startWebSocketServer: require('./ws/WebSocketServer').startWebSocketServer,
    MessageBus: require('./ws/MessageBus').MessageBus,

    // Utility functions
    describeRoutes,
    withRouteIndex,
    BaseLifecycle,
    BaseLifeCycle: BaseLifecycle // Alias for compatibility
};
