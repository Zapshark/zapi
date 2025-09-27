'use strict';

const { EventEmitter } = require('events');

/**
 * InfraStatus
 * Cluster-worker-local readiness flags with simple events.
 * Services check these to decide if they should use fallbacks.
 */
class InfraStatus extends EventEmitter {
    constructor() {
        super();
        this.flags = {
            redisUp: false,
            mongoUp: false,
        };
    }

    set(name, val, meta = {}) {
        const prev = !!this.flags[name];
        const next = !!val;
        this.flags[name] = next;
        if (prev !== next) {
            this.emit(`${name}:${next ? 'up' : 'down'}`, { ts: Date.now(), ...meta });
        }
    }

    isRedisUp() { return !!this.flags.redisUp; }
    isMongoUp() { return !!this.flags.mongoUp; }
}

module.exports = new InfraStatus();
