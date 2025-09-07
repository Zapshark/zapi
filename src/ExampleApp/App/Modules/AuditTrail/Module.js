'use strict';
const { BaseModule } = require('zapi');
const AuditRepository = require('./Repositories/AuditRepository');
const AuditService = require('./Services/AuditService');

class AuditTrailModule extends BaseModule {
    constructor({ framework, name = 'AuditTrail' }) {
        super({ framework, name });
    }

    async init() {
        // Compose
        this.repo = new AuditRepository({ framework: this.framework });
        this.service = new AuditService({ framework: this.framework, repo: this.repo });

        // Expose to the app


        // Let others know this module is ready
        this.framework.emit('audit:module:init', { module: this.name });
    }

    async start() {
        this.service.attachFrameworkListeners();
        await this.service.record('module:start', { module: this.name }, 'module');
    }

    async stop() {
        this.service.detachFrameworkListeners();
        await this.service.record('module:stop', { module: this.name }, 'module');
    }
}

module.exports = AuditTrailModule;
