'use strict';

module.exports = {
    name: 'MyApp',
    rootPath: '/api',
    port: process.env.PORT || 3000,
    shutdownTimeout: 10000,
    backend: {
        path: '/backend',
        enabled: true
    },
    models: {
        aliasWhenSingle: true,
    }
};
