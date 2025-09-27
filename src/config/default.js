'use strict';

module.exports = {
    env: process.env.NODE_ENV || 'development',
    logLevel: 'info',

    coordinator: {enable: true},

    express: {
        enable: true,
        port: Number(process.env.PORT || 3000),
        workers: Number(process.env.INSTANCES || 2),
        trustProxy: true
    },

    mongo: {
        uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/myapp',
        options: {}
    },

    redis: {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
        keyPrefix: process.env.REDIS_PREFIX || 'myapp:'
    },

    // 👇 NEW: central knobs for how noisy health reporting is
    zapi: {
        serverName: process.env.ZAPI_SERVER_NAME || 'zapiAppServer',
        monitoring: {
            enable: true,            // <— NEW: toggle core MonitoringService on/off (default ON)
            leaderOnly: true,        // run monitor only on worker 0 by default
            printHeartbeats: false,  // console print throttle for heartbeats (default quiet)
            heartbeatWindowMs: 5000, // min gap between heartbeat prints

            // existing snapshot/workers knobs you already added are fine to keep:
            system: {
                broadcast: true,
                intervalMs: 60000,
                detail: 'summary'
            },
            worker: {
                broadcast: false,
                intervalMs: 60000,
                ipcIntervalMs: 5000,
                detail: 'summary'
            },

            // For the example app logger (below)
            appLogger: {
                enable: false,                      // default OFF
                file: './store/logs/zapi-events.log',
                flushEveryMs: 10000,                // buffer flush cadence
                maxBuffer: 200                      // flush when this many lines buffered
            },
            apiBackend: {
                enabled: true,                        // Toggle the backend on/off
                basePath: '/_zapi',                   // Mount path
                headerName: 'x-zapi-backend-key',     // Header to read from
                apiKeyHash: process.env.ZAPI_BACKEND_SECRET,                       // pbkdf2$310000$<base64salt>$<base64hash>
                keyMinLength: 16,                     // sanity guard when generating keys
            },
            health: {
                require: {
                    mongo: true,   // force require Mongo
                    redis: false   // e.g., don’t require Redis for overall Ok
                }
            },
            jobqueue: {
                throttlecount: 100,
                throttletime: 1,
                useredis: true,
                jobworkerinstances: 1,
                broadcast: true,
                leaderOnly: true,
            },
            localEcho: false                      // keep off to avoid duplicates
        }
    },

    websocket: {
        enable: true,
        port: 8081,
        workers: 2,
        prefix: 'ws',
        heartbeatIntervalMs: 30000
    }
};
