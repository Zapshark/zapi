'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BaseLifecycle } = require('@zapshark/zapi');
const { resolveService, setService } = require('@zapshark/zapi');
const { getConfig } = require('@zapshark/zapi');

class AppMonitoringLogger extends BaseLifecycle {
    static artifactName = 'AppMonitoringLogger';
    static artifactKind  = 'service';

    constructor() {
        super({ name: AppMonitoringLogger.artifactName, kind: AppMonitoringLogger.artifactKind });
        this._off = null;
        this._buf = [];
        this._timer = null;
        setService(AppMonitoringLogger.artifactName, this);
        console.log('[AppMonitoringLogger] registered (example)');
    }

    _cfg() { return getConfig?.() || {}; }

    _enabled() {
        return !!(this._cfg()?.zapi?.monitoring?.appLogger?.enable);
    }

    _leaderOnly() {
        const cfg = this._cfg();
        return cfg?.zapi?.monitoring?.leaderOnly !== false;
    }

    _isLeader() {
        if (!this._leaderOnly()) return true;
        const idx = Number(process.env.WORKER_INDEX || 0);
        return idx === 0;
    }

    _opts() {
        const a = this._cfg()?.zapi?.monitoring?.appLogger || {};
        return {
            file: a.file || './store/logs/zapi-events.log',
            flushEveryMs: Number(a.flushEveryMs ?? 10000),
            maxBuffer: Number(a.maxBuffer ?? 200)
        };
    }

    _line(env) {
        const { event, eventHeader = {}, eventPayload } = env || {};
        const { origin, ts, state } = eventHeader || {};
        const when = ts ? new Date(ts).toISOString() : new Date().toISOString();
        let payloadStr = '';
        try { payloadStr = JSON.stringify(eventPayload); } catch {}
        return `[${when}] ${event} origin=${origin} status=${state?.status} payload=${payloadStr}`;
    }

    _flushSync(lines) {
        const { file } = this._opts();
        const dir = path.dirname(file);
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        // 👇 Intentionally commented out final write; uncomment to enable file logging
         try { fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8'); } catch (e) { console.error('[AppMonitoringLogger] write error', e); }
        console.log(`[AppMonitoringLogger] (pseudo) flushed ${lines.length} lines to ${file}`);
    }

    async start() {
        if (!this._enabled()) {
            console.log('[AppMonitoringLogger] disabled via zapi.monitoring.appLogger.enable=false');
            return;
        }
        if (!this._isLeader()) {
            console.log('[AppMonitoringLogger] leaderOnly=true → skipping in this worker');
            return;
        }

        const EventServer = resolveService('EventServer');
        if (!EventServer) {
            console.warn('[AppMonitoringLogger] EventServer not available');
            return;
        }

        const { flushEveryMs, maxBuffer } = this._opts();

        // periodic flusher timer
        this._timer = setInterval(() => {
            if (!this._buf.length) return;
            const take = this._buf.splice(0, this._buf.length);
            this._flushSync(take);
        }, flushEveryMs);

        this._off = await EventServer.subscribe('zapi:*', (env) => {
            try {
                this._buf.push(this._line(env));
                if (this._buf.length >= maxBuffer) {
                    const take = this._buf.splice(0, this._buf.length);
                    this._flushSync(take);
                }
            } catch {}
        });

        console.log('[AppMonitoringLogger] subscribed to zapi:* (leaderOnly)', { maxBuffer, flushEveryMs });
    }

    async stop() {
        try { this._off?.(); } catch {}
        this._off = null;
        try { if (this._timer) clearInterval(this._timer); } catch {}
        this._timer = null;
        // final flush
        if (this._buf.length) {
            const take = this._buf.splice(0, this._buf.length);
            this._flushSync(take);
        }
    }
}

module.exports = AppMonitoringLogger;
