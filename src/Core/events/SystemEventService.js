'use strict';

const { BaseLifecycle } = require('../BaseLifecycle');
const { resolveService, setService } = require('../registry/services');
const { getConfig } = require('../Config');

class SystemEventService extends BaseLifecycle {
    static artifactName = 'SystemEventService';
    static artifactKind  = 'service';

    constructor({ resolveService: rs } = {}) {
        super({ name: SystemEventService.artifactName, kind: SystemEventService.artifactKind });
        this.resolveService = rs || resolveService;
        setService(SystemEventService.artifactName, this);
        console.log('[SystemEventService] auto-registered service "SystemEventService"');
    }

    async start() {
        // inside SystemEventService.start() (the unconditional copy)
        const cfg = require('../Config').getConfig?.() || {};
        const localEcho = !!cfg?.zapi?.monitoring?.localEcho;
        if (!localEcho) return;
        const EventServer = this.resolveService('EventServer');
        if (!EventServer) return;
        EventServer.registerAdapter({
            publish: async (env) => { try { EventServer.local.emit(env.event, env); } catch {} }
        });

    }

    async stop() {/* noop */}
}

module.exports = SystemEventService;
