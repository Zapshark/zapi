'use strict';

const { BaseLifecycle } = require('../core/BaseLifecycle');

/**
 * BusService
 *  - Provides room-centric helpers on top of MessageBus.
 *  - Integrates with ioredis via WorkerServer’s cache.duplicate().
 *
 * Usage from controllers/services (after auto-registration):
 *   const Bus = resolveService('BusService');
 *   Bus.createRoom('chat');
 *   const off = await Bus.addHook('chat', (payload) => { ... });
 *   await Bus.publishToRoom('chat', { ... });
 *   off();                // remove that hook
 *   Bus.removeRoom('chat'); // drop room and its redis subscriptions
 */
class BusService extends BaseLifecycle {
    // Artifact metadata for registry/discovery
    static artifactName = 'BusService';
    static artifactKind = 'service';

    /**
     * Constructs the BusService.
     * @param {{bus: any, wss?: any, cache?: any, config?: any}} o
     *   - bus: MessageBus instance (required)
     *   - wss: WebSocketServer instance (optional)
     *   - cache: Redis cache (optional)
     *   - config: Service config (optional)
     */
    constructor({ bus, wss, cache, config } = {}) {
        super({ name: BusService.artifactName, kind: BusService.artifactKind });
        if (!bus) throw new Error('[BusService] bus is required');
        this.bus = bus;     // MessageBus for pub/sub
        this.wss = wss;     // Optional WebSocketServer for direct broadcast
        this.cache = cache; // Optional Redis cache
        this.config = config;

        this._rooms = new Set(); // Track created rooms
        /**
         * Map of room name -> Set of unsubscribe functions for hooks
         * Used to clean up listeners when removing rooms.
         */
        this._roomUnsubs = new Map();
    }

    // Lifecycle hooks for service management
    async init()  { this.log.info('init'); }
    async start() { this.log.info('start'); }
    async stop()  {
        this.log.info('stop');
        // Remove all hooks and clear rooms on shutdown
        for (const [room, set] of this._roomUnsubs.entries()) {
            for (const unsub of set) { try { unsub(); } catch {} }
            set.clear();
        }
        this._roomUnsubs.clear();
        this._rooms.clear();
    }

    // ---------- Room Management / Hook Registration ----------

    /**
     * Creates a new room for pub/sub.
     * @param {string} room - Room name
     * @returns {boolean} - True if created
     */
    createRoom(room) {
        if (!room) throw new Error('[BusService] room is required');
        this._rooms.add(room);
        if (!this._roomUnsubs.has(room)) this._roomUnsubs.set(room, new Set());
        return true;
    }

    /**
     * Removes a room and all its hooks.
     * @param {string} room - Room name
     * @returns {number} - Number of hooks removed
     */
    removeRoom(room) {
        if (!room) return 0;
        let count = 0;
        const set = this._roomUnsubs.get(room);
        if (set) {
            for (const unsub of set) { try { unsub(); } catch {} count++; }
            set.clear();
            this._roomUnsubs.delete(room);
        }
        this._rooms.delete(room);
        return count;
    }

    /**
     * Adds a hook (listener) for a room.
     * Returns an unsubscribe function to remove the hook.
     * @param {string} room - Room name
     * @param {function} handler - Handler for incoming payloads
     * @returns {function} - Unsubscribe function
     */
    async addHook(room, handler) {
        if (!room) throw new Error('[BusService] addHook requires a room');
        if (typeof handler !== 'function') throw new Error('[BusService] addHook requires a function');

        this.createRoom(room);
        const channel = `room:${room}`;

        // Subscribe to MessageBus channel; returns unsubscribe function
        const unsub = await this.bus.subscribe(channel, (payload) => {
            try { handler(payload); } catch (e) { this.log.warn('hook error:', e?.message); }
        });

        // Track unsubscribe for cleanup
        const set = this._roomUnsubs.get(room);
        set.add(unsub);

        // Return a function to remove this hook
        return () => {
            try { unsub(); } catch {}
            set.delete(unsub);
        };
    }

    /**
     * Alias for addHook; subscribes to a room.
     * @param {string} room
     * @param {function} handler
     * @returns {function} Unsubscribe function
     */
    async subscribeRoom(room, handler) {
        return this.addHook(room, handler);
    }

    /**
     * Publishes a payload to a room via MessageBus.
     * @param {string} room - Room name
     * @param {*} payload - Data to send
     */
    async publishToRoom(room, payload) {
        if (!room) throw new Error('[BusService] publishToRoom requires a room');
        await this.bus.publish(`room:${room}`, payload);
    }

    /**
     * Lists all created rooms.
     * @returns {string[]} - Array of room names
     */
    listRooms() { return Array.from(this._rooms.values()); }

    /**
     * Returns the number of hooks registered for a room.
     * @param {string} room
     * @returns {number}
     */
    countHooks(room) {
        const set = this._roomUnsubs.get(room);
        return set ? set.size : 0;
    }

    /**
     * Optionally broadcasts a message directly to connected WebSocket clients,
     * bypassing the MessageBus. Can filter clients.
     * @param {*} message - Data to send
     * @param {function} [filter] - Optional filter function (ws) => boolean
     * @returns {number} - Number of clients sent to
     */
    broadcast(message, filter) {
        if (!this.wss) return false;
        const data = JSON.stringify(message);
        let sent = 0;
        try {
            this.wss.clients.forEach((ws) => {
                if (ws.readyState === ws.OPEN && (!filter || filter(ws))) {
                    try { ws.send(data); sent++; } catch {}
                }
            });
        } catch {}
        return sent;
    }
}

// Export the BusService class for use in the application
module.exports = { BusService };
