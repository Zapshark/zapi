'use strict';

const { BaseLifecycle, resolveService } = require('@zapshark/zapi');

/**
 * NotificationService
 * - Manages per-user rooms: "user:<userId>"
 * - Publish notifications, add/remove runtime hooks, tear down rooms.
 *
 * Client pattern:
 *   ws.send(JSON.stringify({ type: 'join', room: `user:${userId}` }))
 */
class NotificationService extends BaseLifecycle {
    static artifactName = 'NotificationService';
    static artifactKind = 'service';

    constructor({ cache, config } = {}) {
        super({ name: NotificationService.artifactName, kind: NotificationService.artifactKind });
        this.cache = cache;
        this.config = config;

        /** userId -> { room, hooks:Set<Function> } */
        this._users = new Map();
    }

    get Bus() { return resolveService('BusService'); }

    async init()  { this.log.info('init'); }
    async start() { this.log.info('start'); }
    async stop()  {
        this.log.info('stop');
        // Remove all hooks + drop all rooms
        for (const [userId] of this._users) {
            await this.removeUser(userId);
        }
    }

    /* ---------- room lifecycle ---------- */

    roomName(userId) { return `user:${String(userId)}`; }

    ensureUser(userId) {
        const id = String(userId);
        if (!id) throw new Error('userId required');
        if (!this._users.has(id)) {
            const room = this.roomName(id);
            this.Bus.createRoom(room);
            this._users.set(id, { room, hooks: new Set() });
        }
        return this._users.get(id);
    }

// remove user room (no stripping)
    async removeUser(userId) {
        const id = String(userId);
        const entry = this._users.get(id);
        if (!entry) return { ok: false, reason: 'not_found' };

        for (const off of entry.hooks) { try { off(); } catch {} }
        entry.hooks.clear();

        // Pass the full room name, e.g. "user:u_42"
        const removed = this.Bus.removeRoom(entry.room);
        this._users.delete(id);
        return { ok: true, removedHooks: removed };
    }

    /* ---------- publish / subscribe ---------- */

    /** Fire-and-forget notify to this user's room */
// publish a notification (no stripping)
    async notify(userId, payload) {
        const entry = this.ensureUser(userId);
        // entry.room is like "user:u_42"
        await this.Bus.publishToRoom(entry.room, {
            type: 'notification',
            ts: Date.now(),
            ...payload
        });
        return { ok: true };
    }




    /**
     * Add a server-side hook for this user's notifications.
     * Returns unsubscribe() you can call later; we also store it to clean up on removeUser().
     */
    async onNotification(userId, handler) {
        const entry = this.ensureUser(userId);
        const off = await this.Bus.addHook(entry.room.replace(/^.*?:/, ''), (evt) => {
            try { handler(evt, { userId }); } catch (e) { this.log.warn('hook error:', e?.message); }
        });
        entry.hooks.add(off);
        return () => { try { off(); } finally { entry.hooks.delete(off); } };
    }
}

module.exports = NotificationService;
