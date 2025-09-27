'use strict';

/**
 * OutageDeduper
 * Coalesces repeated DOWN events into a single logical outage, and only re-emits on UP.
 * Works per "resource key" (e.g., "redis:default", "mongo:primary").
 *
 * Usage:
 *   const d = require('./OutageDeduper');
 *   d.down('redis:default', { reason: 'ECONNREFUSED' });
 *   d.up('redis:default');  // resets the outage and allows next DOWN to print once again
 */
const states = new Map(); // key -> { down: boolean, lastDownAt: number, lastReason?: string }

function isDown(key) { return !!states.get(key)?.down; }

function down(key, meta = {}) {
    const s = states.get(key) || { down: false };
    if (s.down) return { emitted: false };
    s.down = true; s.lastAt = Date.now(); s.lastReason = meta.reason || null;
    states.set(key, s);
    return { emitted: true, meta: { ...s } };
}
function up(key, meta = {}) {
    const s = states.get(key) || { down: false };
    const wasDown = !!s.down;
    s.down = false; s.lastUpAt = Date.now(); s.lastUpMeta = meta;
    states.set(key, s);
    return { emitted: wasDown };
}

module.exports = { down, up, isDown };
