'use strict';

module.exports = {
    env: process.env.NODE_ENV || 'development',

    zapi: {
        serverName: process.env.ZAPI_SERVER_NAME || 'zapiAppServer',
        monitoring: {
            enable: true,            // <— NEW: toggle core MonitoringService on/off (default ON)
            leaderOnly: true,        // run monitor only on worker 0 by default
            printHeartbeats: true,  // console print throttle for heartbeats (default quiet)
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
                enable: true,
                file: "./store/logs/zapi-events.log",
                flushEveryMs: 5000,
                maxBuffer: 50
            },

            localEcho: false                      // keep off to avoid duplicates
        },
        apiBackend: {
            enabled: true,                             // Toggle the entire backend on/off
            basePath: '/_zapi',                        // Path the backend is served from
            headerName: 'x-zapi-backend-key',          // Auth header to check
            // Use the CLI below to generate this value; store ONLY the hash, never the raw key
            apiKeyHash: '',                            // e.g. "pbkdf2$310000$<base64salt>$<base64hash>"
            keyMinLength: 16,                          // sanity requirement when generating keys
        },
        jobqueue: {
            throttlecount: 100,
            throttletime: 1,
            useredis: true,
            jobworkerinstances: 1,
            broadcast: true,
            leaderOnly: true,
        },
        health: {
            require: {
                mongo: true,   // Whether to force require MongoDB
                redis: false   // Wheter to force require Redis for overall Ok
            }
        }
    },
    logLevel: 'debug',
    coordinator: { enable: true },
    debugPaths:  true,          // <- shows what got resolved
    internalExample: false,      // <- so you notice if host files weren’t found
    shapeKey: "success",
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
    websocket: {
        enable: true,
        port: 8081,
        workers: 2,
        prefix: "ws",
        heartbeatIntervalMs: 30000
    }
};
