'use strict';

/**
 * Minimal in-memory audit "model" with CRUD shape
 */
let _id = 0;
const rows = new Map();

module.exports = {
    async create(data) {
        const id = String(++_id);
        const now = new Date().toISOString();
        const doc = {
            id,
            ts: now,
            type: data.type || 'custom',
            source: data.source || 'unknown',
            payload: data.payload ?? null
        };
        rows.set(id, doc);
        return doc;
    },
    async findById(id) {
        return rows.get(String(id)) || null;
    },
    async find(filter = {}, opts = {}) {
        let list = Array.from(rows.values());
        // Simple filter support
        if (filter.type) list = list.filter(e => e.type === filter.type);
        if (filter.since) list = list.filter(e => e.ts >= filter.since);
        // Basic ordering / limiting
        if (opts.desc) list = list.sort((a,b) => (a.ts < b.ts ? 1 : -1));
        if (opts.limit) list = list.slice(0, opts.limit);
        return list;
    },
    async update(id, patch) {
        const doc = rows.get(String(id));
        if (!doc) return null;
        Object.assign(doc, patch);
        return doc;
    },
    async remove(id) {
        return rows.delete(String(id));
    },
    async clear() {
        rows.clear();
        return { ok: true };
    }
};
