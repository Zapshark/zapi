'use strict';

const { BaseLifecycle } = require('../BaseLifecycle');
const { resolveService, setService } = require('../registry/services');
const { getConfig } = require('../Config');

class MonitoringService extends BaseLifecycle {
    static artifactName = 'MonitoringService';
    static artifactKind  = 'service';

    constructor() {
        super({ name: MonitoringService.artifactName, kind: MonitoringService.artifactKind });
        this._off = null;
        this._lastHeartbeatPrint = 0; // throttle
        setService(MonitoringService.artifactName, this);
        console.log('[MonitoringService] core service registered');
    }

    _cfg() { return getConfig?.() || {}; }

    _enabled() {
        const cfg = this._cfg();
        // toggle core monitor here
        return cfg?.zapi?.monitoring?.enable !== false; // default ON
    }

    _leaderOnly() {
        const cfg = this._cfg();
        return cfg?.zapi?.monitoring?.leaderOnly !== false; // default true
    }

    _isLeader() {
        if (!this._leaderOnly()) return true;
        const idx = Number(process.env.WORKER_INDEX || 0);
        return idx === 0;
    }

    _hbWindowMs() {
        const cfg = this._cfg();
        // throttle printing of heartbeats in console
        return Number(cfg?.zapi?.monitoring?.heartbeatWindowMs ?? 5000);
    }

    _printHeartbeats() {
        const cfg = this._cfg();
        const v = cfg?.zapi?.monitoring?.printHeartbeats;
        return v === undefined ? false : !!v; // default quiet
    }

    async start() {
        if (!this._enabled()) {
            console.log('[MonitoringService] disabled via zapi.monitoring.enable=false');
            return;
        }
        if (!this._isLeader()) {
            console.log('[MonitoringService] leaderOnly=true → skipping in this worker');
            return;
        }

        const EventServer = resolveService('EventServer');
        if (!EventServer) {
            console.warn('[MonitoringService] EventServer not available');
            return;
        }

        // subscribe to all ZAPI events (wildcard), with simple heartbeat throttling
        this._off = await EventServer.subscribe('zapi:*', (env) => {
            if (!env) return;
            const { event, eventHeader = {}, eventPayload } = env;
            const { origin, ts, state } = eventHeader;

            if (event === 'zapi:sys:heartbeat' || event === 'zapi:sys:heartbeat:snapshot') {
                if (!this._printHeartbeats()) return;
                const now = Date.now();
                if (now - this._lastHeartbeatPrint < this._hbWindowMs()) return;
                this._lastHeartbeatPrint = now;
            }

            const when = ts ? new Date(ts).toISOString() : new Date().toISOString();
            try {
                console.log(
                    `[ZAPI-EVENT] ${event} @ ${when} from=${origin} status=${state?.status}`,
                    JSON.stringify(eventPayload)
                );
            } catch {}
        });

        console.log('[MonitoringService] Core monitor active (leaderOnly):', { leaderOnly: this._leaderOnly() });
    }

    async stop() {
        try { this._off?.(); } catch {}
        this._off = null;
    }
}

module.exports = MonitoringService;
