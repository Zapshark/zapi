'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Auto-discovers App/Modules/ws.js
 * Each ws.js should export:
 *   - array of { name, onConnect?, onMessage? }
 *   - OR a function (framework) => same array
 * Registers entries under kind 'wsHandler' with key = name
 */
function load({framework, appRoot, log = console}) {
    const base = path.join(appRoot, 'App', 'Modules');
    if (!fs.existsSync(base)) return {count: 0};

    let count = 0;
    const mods = fs.readdirSync(base).filter(d => fs.statSync(path.join(base, d)).isDirectory());
    for (const m of mods) {
        const file = path.join(base, m, 'ws.js');
        if (!fs.existsSync(file)) continue;
        try {
            let out = require(file);
            if (typeof out === 'function') out = out(framework);
            if (Array.isArray(out)) {
                for (const def of out) {
                    if (!def?.name) continue;
                    framework.register('wsHandler', def.name, def);
                    count++;
                }
                log.info?.(`[WSHandlerLoader] ${m}: registered ${out.length} wsHandler(s)`);
            }
        } catch (e) {
            log.warn?.(`[WSHandlerLoader] ${m}/ws.js failed: ${e.message}`);
        }
    }
    return {count};
}

module.exports = {load};
