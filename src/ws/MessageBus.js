// src/ws/MessageBus.js
'use strict';

// Import Node.js EventEmitter for local pub/sub
const { EventEmitter } = require('events');

/**
 * MessageBus provides a local and optional Redis-backed pub/sub system.
 * - Local events are handled via EventEmitter.
 * - If Redis is available, messages are published and received across processes.
 */
class MessageBus {
    /**
     * @param {Object} opts
     * @param {string} [opts.prefix='ws'] - Prefix for Redis channels
     * @param {function|null} [opts.createRedisClient] - Factory for ioredis client, or null for local-only
     */
    constructor({ prefix = 'ws', createRedisClient } = {}) {
        this.prefix = String(prefix || 'ws'); // Channel prefix
        this.emitter = new EventEmitter();    // Local event emitter

        // Redis client factories and state
        this._createRedisClient = (typeof createRedisClient === 'function') ? createRedisClient : null;
        this._pub = null;           // Redis publisher client
        this._sub = null;           // Redis subscriber client
        this._redisAttached = false;// Whether Redis is active

        // Bind internal handlers for Redis events
        this._onRedisMessage = this._onRedisMessage.bind(this);
        this._onRedisPMessage = this._onRedisPMessage.bind(this);

        // Track local topic subscription counts
        this._topicCounts = new Map();

        // Attempt to attach to Redis if possible
        this._attachRedisIfPossible();

        // Listen for infrastructure changes to hot-attach/detach Redis
        try {
            const Infra = require('../core/infra/InfraStatus');
            Infra.on('redisUp:up',   () => this._attachRedisIfPossible());
            Infra.on('redisUp:down', () => this._detachRedis());
        } catch {
            // InfraStatus not available; remain in current mode
        }
    }

    /* ------------------------- Public API ------------------------- */

    /**
     * Publishes a message to a topic.
     * - Always delivers locally.
     * - If Redis is attached, also publishes to Redis channel.
     * @param {string} topic
     * @param {*} payload
     */
    async publish(topic, payload) {
        const t = String(topic || '').trim();
        if (!t) return;

        // Local delivery
        try { this.emitter.emit(t, payload); } catch {}

        // Redis delivery (if attached and client is healthy)
        if (this._redisAttached && this._pub && typeof this._pub.publish === 'function' && this._pub.status !== 'end') {
            const chan = `${this.prefix}:${t}`;
            try { await this._pub.publish(chan, JSON.stringify(payload)); } catch {}
        }
    }

    /**
     * Subscribes a handler to a topic.
     * - Returns an unsubscribe function.
     * @param {string} topic
     * @param {function} handler
     * @returns {function} Unsubscribe function
     */
    async subscribe(topic, handler) {
        const t = String(topic || '').trim();
        if (!t || typeof handler !== 'function') return () => {};

        this.emitter.on(t, handler);
        this._topicCounts.set(t, (this._topicCounts.get(t) || 0) + 1);

        // Unsubscribe logic
        const off = () => {
            try { this.emitter.off(t, handler); } catch {}
            const n = (this._topicCounts.get(t) || 1) - 1;
            if (n <= 0) this._topicCounts.delete(t); else this._topicCounts.set(t, n);
        };
        return off;
    }

    /**
     * Closes the MessageBus.
     * - Detaches from Redis.
     * - Removes all local listeners.
     */
    async close() {
        this._detachRedis();
        try { this.emitter.removeAllListeners(); } catch {}
    }

    /* ----------------------- Internal methods --------------------- */

    /**
     * Attaches Redis clients if possible.
     * - Sets up publisher and subscriber.
     * - Subscribes to all topics with prefix.
     */
    _attachRedisIfPossible() {
        if (!this._createRedisClient || this._redisAttached) return;

        let pub = null, sub = null;
        try {
            pub = this._createRedisClient();
            sub = this._createRedisClient();
        } catch {
            // Redis unavailable
        }
        if (!pub || !sub) return;

        // Helper to safely add event listeners
        const safeOn = (c, evt, fn) => { try { c && typeof c.on === 'function' && c.on(evt, fn); } catch {} };
        const safePSub = (c, pattern) => { try { c && typeof c.psubscribe === 'function' && c.psubscribe(pattern); } catch {} };

        // Suppress Redis errors (handled elsewhere)
        const onErr = () => {};
        safeOn(pub, 'error', onErr);
        safeOn(sub, 'error', onErr);

        // Subscribe to all channels with prefix
        safeOn(sub, 'message', this._onRedisMessage);
        safeOn(sub, 'pmessage', this._onRedisPMessage);
        safePSub(sub, `${this.prefix}:*`);

        this._pub = pub;
        this._sub = sub;
        this._redisAttached = true;
    }

    /**
     * Detaches Redis clients and cleans up.
     */
    _detachRedis() {
        if (!this._redisAttached) return;

        // Helper to safely remove listeners and quit clients
        const safeOff = (c, evt, fn) => { try { c && typeof c.off === 'function' && c.off(evt, fn); } catch {} };
        const safePUnsub = (c, pattern) => { try { c && typeof c.punsubscribe === 'function' && c.punsubscribe(pattern); } catch {} };
        const safeQuit = (c) => { try { c && typeof c.quit === 'function' && c.quit(); } catch {} };

        safeOff(this._sub, 'message', this._onRedisMessage);
        safeOff(this._sub, 'pmessage', this._onRedisPMessage);
        safePUnsub(this._sub, `${this.prefix}:*`);
        safeQuit(this._sub);
        safeQuit(this._pub);

        this._pub = null;
        this._sub = null;
        this._redisAttached = false;
    }

    /**
     * Handles Redis 'message' events (not used with psubscribe).
     * @param {string} channel
     * @param {string} message
     */
    _onRedisMessage(channel, message) {
        try {
            const topic = this._topicFromChannel(channel);
            const payload = this._safeParse(message);
            if (topic) this.emitter.emit(topic, payload);
        } catch {}
    }

    /**
     * Handles Redis 'pmessage' events for pattern subscriptions.
     * @param {string} _pattern
     * @param {string} channel
     * @param {string} message
     */
    _onRedisPMessage(_pattern, channel, message) {
        try {
            const topic = this._topicFromChannel(channel);
            const payload = this._safeParse(message);
            if (topic) this.emitter.emit(topic, payload);
        } catch {}
    }

    /**
     * Extracts topic from Redis channel name.
     * @param {string} channel
     * @returns {string|null}
     */
    _topicFromChannel(channel) {
        if (!channel || typeof channel !== 'string') return null;
        const p = `${this.prefix}:`;
        if (channel.startsWith(p)) return channel.slice(p.length);
        return null;
    }

    /**
     * Safely parses JSON, falls back to raw string.
     * @param {string} s
     * @returns {*}
     */
    _safeParse(s) {
        try { return JSON.parse(s); } catch { return s; }
    }
}

// Export MessageBus class
module.exports = { MessageBus };
