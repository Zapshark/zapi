'use strict';
const { BaseService } = require('zapi');

/**
 * Captures framework events to an audit log.
 * Subscribes on start; unsubscribes on stop (graceful shutdown safe).
 */
class AuditService extends BaseService {
    constructor({ framework, repo }) {
        super({ framework, name: 'AuditService' });
        this.repo = repo;
        this._unsubs = [];
    }

    // Wire up listeners (call from Module.start or init)
    attachFrameworkListeners() {
        const onMounted = ({ module, mount }) =>
            this.record('controller:mounted', { module, mount });

        const onListening = ({ port }) =>
            this.record('server:listening', { port });

        const onShutdownBegin = ({ signal }) =>
            this.record('shutdown:begin', { signal });

        const onLifecycleInitAfter = () =>
            this.record('lifecycle:init:after', {});

        // Subscribe and keep disposers
        this._unsubs.push(this.framework.on('controller:mounted', onMounted));
        this._unsubs.push(this.framework.on('server:listening', onListening));
        this._unsubs.push(this.framework.on('shutdown:begin', onShutdownBegin));
        this._unsubs.push(this.framework.on('lifecycle:init:after', onLifecycleInitAfter));

        // One-time example
        this.framework.once('discover:done', () => {
            this.record('discover:done', {});
        });
    }

    detachFrameworkListeners() {
        while (this._unsubs.length) {
            const off = this._unsubs.pop();
            try { typeof off === 'function' && off(); } catch {}
        }
    }

    async record(type, payload, source = 'framework') {
        const evt = await this.repo.create({ type, payload, source });
        // Re-emit for anyone else who cares
        this.framework.emit('audit:recorded', evt);
        return evt;
    }

    list({ type, since, limit = 50 } = {}) {
        const filter = {};
        if (type) filter.type = type;
        if (since) filter.since = since;
        return this.repo.find(filter, { desc: true, limit });
    }

    clear() { return this.repo.model.clear(); }
}

module.exports = AuditService;
