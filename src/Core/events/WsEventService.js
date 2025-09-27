'use strict';

const { BaseLifecycle } = require('../BaseLifecycle');
const { setService, resolveService } = require('../registry/services');

class WsEventService extends BaseLifecycle {
    static artifactName = 'WsEventService';
    static artifactKind  = 'service';

    constructor({ wsContext } = {}) {
        super({ name: WsEventService.artifactName, kind: WsEventService.artifactKind });
        this.ws = wsContext || null;  // { broadcast: (json) => void }
        setService(WsEventService.artifactName, this);
        console.log('[WsEventService] auto-registered service "WsEventService"');
    }

    async start() {
        const EventServer = resolveService('EventServer');
        if (!EventServer || !this.ws?.broadcast) return;

        this._off = EventServer.registerAdapter({
            publish: async (env) => {
                // Only broadcast zapi:* over WS
                if (!String(env?.event || '').startsWith('zapi:')) return;
                try { this.ws.broadcast({ type: 'zapi', data: env }); } catch {}
            }
        });
    }

    async stop() { try { this._off?.(); } catch {} }
}

module.exports = WsEventService;
