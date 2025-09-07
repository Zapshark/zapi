'use strict';

/**
 * Simple in-memory registry for cache keys (name -> { ttl, prefix?, notes? }).
 * Backed by your ZapiFramework registry (kind: 'cacheKey').
 */

function registerCacheKey(framework, name, def = {}) {
    if (!name || typeof name !== 'string') throw new Error('cacheKey requires a string name');
    const entry = {
        name,
        ttl: Number.isFinite(def.ttl) ? def.ttl : undefined,
        prefix: def.prefix || '',             // optional namespacing
        notes: def.notes || '',               // optional description
    };
    framework.register('cacheKey', name, entry);
    return entry;
}

function getCacheKey(framework, name) {
    return framework.resolve('cacheKey', name) || null;
}

/**
 * Build a concrete Redis key using a registered cacheKey + dynamic parts.
 * @param {object} o
 * @param {object} o.framework
 * @param {string} o.name     cacheKey name
 * @param {string} [o.suffix] dynamic suffix like an id (`user:42`)
 */
function buildKey({ framework, name, suffix = '' }) {
    const def = getCacheKey(framework, name);
    if (!def) throw new Error(`cacheKey "${name}" not found`);
    const base = (def.prefix ? `${def.prefix}:` : '') + name;
    return suffix ? `${base}:${suffix}` : base;
}

module.exports = { registerCacheKey, getCacheKey, buildKey };
