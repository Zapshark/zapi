'use strict';

const { BaseLifecycle, resolveService } = require('@zapshark/zapi');
const { randomUUID } = require('node:crypto');

/**
 * GroupService
 * - Manages “group:<groupId>” rooms and members.
 * - Publishes chat/notification events via BusService (which reuses your ioredis).
 * - Lets callers register/remove per-group server-side hooks.
 *
 * Events published to room `group:<groupId>` look like:
 *   { type: 'chat', ts, from, text }
 */
class GroupService extends BaseLifecycle {
    static artifactName = 'GroupService';
    static artifactKind = 'service';

    constructor({ cache, config } = {}) {
        super({ name: GroupService.artifactName, kind: GroupService.artifactKind });
        this.cache = cache;
        this.config = config;

        /** in-memory registry: groupId -> { room, name?, members:Set<string>, hooks:Set<Function> } */
        this._groups = new Map();
    }

    get Bus() {
        // BusService is registered by the worker at startup, so it’s resolvable here.
        return resolveService('BusService');
    }

    async init()  { this.log.info('init'); }
    async start() { this.log.info('start'); }
    async stop()  {
        this.log.info('stop');
        // tear down all rooms + hooks
        for (const [groupId] of this._groups) {
            await this.deleteGroup(groupId);
        }
    }

    // ---- CRUD-ish helpers -----------------------------------------------------

    /**
     * Create a group and its WS room.
     * @param {object} o
     * @param {string} [o.name]
     * @param {string[]} [o.members=[]]
     */
    async createGroup({ name, members = [] } = {}) {
        const groupId = randomUUID();
        const room = `group:${groupId}`;

        // idempotent room create on the bus
        this.Bus.createRoom(room);

        this._groups.set(groupId, {
            room,
            name: name || null,
            members: new Set(members),
            hooks: new Set(),
        });

        // (optional) server-side hook example — log all group messages
        const off = await this.Bus.addHook(room, (evt) => {
            this.log.debug(`[${room}]`, evt);
        });
        this._groups.get(groupId).hooks.add(off);

        return { groupId, room, name: name || null, members: Array.from(this._groups.get(groupId).members) };
    }

    /**
     * Permanently delete a group: removes hooks + unsubscribes Redis + drops room.
     */
    async deleteGroup(groupId) {
        const g = this._groups.get(groupId);
        if (!g) return { ok: false, reason: 'not_found' };
        for (const off of g.hooks) { try { off(); } catch {} }
        g.hooks.clear();
        const removed = this.Bus.removeRoom(g.room); // pass "group:<id>"
        this._groups.delete(groupId);
        return { ok: true, removedHooks: removed };
    }

    // ---- membership -----------------------------------------------------------

    addMember(groupId, userId) {
        const g = this._groups.get(groupId);
        if (!g) throw new Error('group not found');
        g.members.add(String(userId));
        return { ok: true, members: Array.from(g.members) };
    }

    removeMember(groupId, userId) {
        const g = this._groups.get(groupId);
        if (!g) throw new Error('group not found');
        g.members.delete(String(userId));
        return { ok: true, members: Array.from(g.members) };
    }

    list(groupId) {
        const g = this._groups.get(groupId);
        if (!g) throw new Error('group not found');
        return {
            groupId,
            name: g.name,
            room: g.room,
            members: Array.from(g.members),
            hookCount: g.hooks.size
        };
    }

    // ---- chat / notifications -------------------------------------------------

    /**
     * Publish a chat message to the group room (fan-out to all workers via Redis).
     */
    async sendMessage(groupId, { from, text }) {
        const g = this._groups.get(groupId);
        if (!g) throw new Error('group not found');
        const payload = { type: 'chat', ts: Date.now(), from: String(from || 'system'), text: String(text || '') };
        await this.Bus.publishToRoom(g.room, payload); // g.room is "group:<id>"
        return { ok: true };
    }

    /**
     * Add a server-side hook that runs for every message published to this group.
     * Returns an unsubscribe you can call later.
     */
    async onMessage(groupId, handler) {
        const g = this._groups.get(groupId);
        if (!g) throw new Error('group not found');
        const off = await this.Bus.addHook(g.room.replace(/^.*?:/, ''), handler);
        g.hooks.add(off);
        return () => { try { off(); } finally { g.hooks.delete(off); } };
    }
}

module.exports = GroupService;
