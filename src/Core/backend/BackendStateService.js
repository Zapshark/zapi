'use strict';
const { BaseLifecycle } = require('../BaseLifecycle');
const { setService, resolveService } = require('../registry/services');

class BackendStateService extends BaseLifecycle {
    static artifactName = 'BackendStateService';
    static artifactKind  = 'service';

    constructor() {
        super({ name: BackendStateService.artifactName, kind: BackendStateService.artifactKind });
        this.lastHeartbeatSnapshot = null; // from zapi:sys:heartbeat:snapshot (leader-aggregated)
        this.lastMetricsSnapshot   = null; // from zapi:sys:metrics:flush (leader-aggregated)
        setService(BackendStateService.artifactName, this);
    }

    async start() {
        const EventServer = resolveService('EventServer');
        if (!EventServer) return;

        this._offHb = await EventServer.subscribe('zapi:sys:heartbeat:snapshot', (env) => {
            this.lastHeartbeatSnapshot = env?.eventPayload || null;
        });

        this._offMx = await EventServer.subscribe('zapi:sys:metrics:flush', (env) => {
            this.lastMetricsSnapshot = env?.eventPayload || null;
        });
    }

    async stop() { try { this._offHb?.(); } catch {} try { this._offMx?.(); } catch {} }

    getLatest() {
        return {
            heartbeat: this.lastHeartbeatSnapshot,
            metrics: this.lastMetricsSnapshot,
        };
    }
}

module.exports = BackendStateService;
