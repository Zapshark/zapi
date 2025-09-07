'use strict';

module.exports = {
    Redis: {
        enabled: true,
        servers: [
            {
                host: process.env.REDIS_HOST_PRIMARY || '127.0.0.1',
                port: Number(process.env.REDIS_PORT_PRIMARY || 6379),
                password: process.env.REDIS_PASS_PRIMARY || undefined,
                prefix: process.env.REDIS_PREFIX_PRIMARY || 'app',
                db: 0
            },
            {
                host: process.env.REDIS_HOST_SECONDARY || '127.0.0.1',
                port: Number(process.env.REDIS_PORT_SECONDARY || 6379),
                password: process.env.REDIS_PASS_SECONDARY || undefined,
                prefix: process.env.REDIS_PREFIX_SECONDARY || 'app',
                db: 0
            }
        ]
    }
};
