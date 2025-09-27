'use strict';

const { EventEmitter } = require('node:events');
const { BaseLifecycle } = require('../BaseLifecycle');
const { setService } = require('../registry/services');

class EventServer extends BaseLifecycle {
    static artifactName = 'EventServer';
    static artifactKind = 'service';

    constructor({ resolveService } = {}) {
        super({ name: EventServer.artifactName, kind: EventServer.artifactKind });
        this.resolveService = resolveService;
        this.local = new EventEmitter();
        this.adapters = new Set();     // transport adapters (system, redis, ws, …)
        this._started = false;
        this._buffer = [];             // envelopes buffered before start()

        // auto-register
        try { setService(EventServer.artifactName, this); } catch {}
        console.log('[EventServer] auto-registered service "EventServer"');
    }

    registerAdapter(adapter) {
        if (adapter && typeof adapter.publish === 'function') this.adapters.add(adapter);
        return () => { try { this.adapters.delete(adapter); } catch {} };
    }

    async start() {
        this._started = true;
        // Drain any buffered envelopes from early boot.
        try {
            for (const env of this._buffer.splice(0)) {
                this.local.emit(env.event, env);
                this.local.emit('*', env);
                for (const ad of this.adapters) { try { await ad.publish(env); } catch {} }
            }
        } catch {}
    }

    async stop() {
        this._started = false;
        try { this.local.removeAllListeners(); } catch {}
    }

    // Publish a ZAPI envelope
    async publish(event, payload = {}) {
        const Health = this.resolveService ? this.resolveService('HealthService') : null;
        const state = Health?.getState ? Health.getState() : { status: 'Ok', meta: {} };

        const origin = (process.env.ZAPI_SERVER_NAME || 'zapiAppServer');
        const env = {
            event,
            eventHeader: {
                origin,
                ts: Date.now(),
                state: {
                    status: state.status || 'Ok',
                    meta: {
                        ...(state.meta || {}),
                        pid: process.pid,
                        workerIndex: Number(process.env.WORKER_INDEX ?? -1),
                        role: (process.env.ZAPI_PRIMARY === '1') ? 'primary' : 'worker'
                    }
                }
            },
            eventPayload: payload
        };

        if (!this._started) {
            this._buffer.push(env);
            return;
        }

        this.local.emit(event, env);
        this.local.emit('*', env);
        for (const ad of this.adapters) { try { await ad.publish(env); } catch {} }
    }

    // Subscribe to a concrete topic or wildcard ('*' or 'zapi:*')
// Subscribe to a concrete topic or wildcard ('*' or 'zapi:*')
    async subscribe(topic, handler) {
        const fn = (env) => {
            if (topic === '*' || topic === 'zapi:*') return handler(env);
            if (env?.event === topic) return handler(env);
            if (topic.endsWith('*')) {                 // simple prefix match for 'namespace:*'
                const p = topic.slice(0, -1);
                if (String(env?.event || '').startsWith(p)) return handler(env);
            }
        };

        const isWild = (topic === '*' || topic.endsWith('*'));
        if (isWild) this.local.on('*', fn);          // only attach '*' when wildcard
        this.local.on(topic, fn);

        return () => {
            try { if (isWild) this.local.off('*', fn); } catch {}
            try { this.local.off(topic, fn); } catch {}
        };
    }



    // Convenience: subscribe to ALL events
    async any(handler) {
        this.local.on('*', handler);
        return () => { try { this.local.off('*', handler); } catch {} };
    }
}

module.exports = EventServer;
