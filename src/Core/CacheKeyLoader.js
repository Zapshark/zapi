'use strict';
const fs = require('fs');
const path = require('path');
const { registerCacheKey } = require('./CacheKeyRegistry');

/**
 * Looks for files named "cache.keys.js" under App/Modules/ and loads their exports.
* A module file can export:
*   - array: [{ name, ttl, prefix?, notes? }, ...]
*   - function: (framework) => [ ...same array ]
*/
function load({ framework, appRoot, log = console }) {
    const base = path.join(appRoot, 'App', 'Modules');
    if (!fs.existsSync(base)) return { count: 0 };
    let count = 0;

    const mods = fs.readdirSync(base).filter(d => fs.statSync(path.join(base, d)).isDirectory());
    for (const m of mods) {
        const file = path.join(base, m, 'cache.keys.js');
        if (!fs.existsSync(file)) continue;
        try {
            let out = require(file);
            if (typeof out === 'function') out = out(framework);
            if (Array.isArray(out)) {
                for (const def of out) {
                    registerCacheKey(framework, def.name, def);
                    count++;
                }
                log?.info?.(`[CacheKeyLoader] ${m}: registered ${out.length} key(s)`);
            }
        } catch (e) {
            log?.warn?.(`[CacheKeyLoader] ${m}/cache.keys.js failed: ${e.message}`);
        }
    }
    return { count };
}

module.exports = { load };
