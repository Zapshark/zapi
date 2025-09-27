/* --- FILE: src/core/system/SystemEvents.js --- */
'use strict';

/**
 * Array of all core ZAPI system events with a description.
 * Useful for docs, monitoring dashboards, or route helpers.
 */
const SystemEvents = [
    { event: 'zapi:sys:boot:start',       description: 'Worker process boot has begun' },
    { event: 'zapi:sys:bootstrap:done',   description: 'App bootstrap function executed' },
    { event: 'zapi:sys:routes:attached',  description: 'Express routes attached' },
    { event: 'zapi:sys:http:ready',       description: 'HTTP server is listening' },
    { event: 'zapi:sys:ws:ready',         description: 'WebSocket server is listening' },

    { event: 'zapi:sys:primary:ready',        description: 'Primary cluster process forked workers' },
    { event: 'zapi:sys:primary:worker:exit',  description: 'Primary detected worker exit' },
    { event: 'zapi:sys:primary:stopping',     description: 'Primary is stopping and signaling workers' },

    { event: 'zapi:sys:heartbeat',            description: 'Single worker heartbeat tick' },
    { event: 'zapi:sys:heartbeat:snapshot',   description: 'Aggregated heartbeat across workers' },

    { event: 'zapi:sys:metrics',              description: 'Raw metrics increment event' },
    { event: 'zapi:sys:metrics:flush',        description: 'Aggregated metrics flush' },

    { event: 'zapi:sys:shutdown:init',        description: 'Worker shutdown initiated' },
    { event: 'zapi:sys:shutdown:done',        description: 'Worker shutdown completed' }
];

module.exports = { SystemEvents };
