// src/core/loader/MiddlewareLoader.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { setMiddleware } = require('../registry/middleware');

/**
 * Recursively walks a directory to find all .js middleware files (excluding tests/specs).
 * @param {string} dir
 * @param {Array<string>} out
 * @returns {Array<string>}
 */
function _walk(dir, out = []) {
    try {
        for (const name of fs.readdirSync(dir)) {
            const abs = path.join(dir, name);
            const st = fs.statSync(abs);
            if (st.isDirectory()) _walk(abs, out);
            else if (name.endsWith('.js') && !name.endsWith('.test.js') && !name.endsWith('.spec.js')) out.push(abs);
        }
    } catch {}
    return out;
}

/**
 * Loads and registers all middleware (except _global.js) from appDirs.
 * @param {Array<string>} appDirs
 * @param {object} ctx
 * @param {object} logger
 * @returns {Array<string>} Loaded middleware names
 */
function loadAppMiddlewares(appDirs, ctx, logger) {
    const loaded = [];
    for (const base of appDirs) {
        const dir = path.join(base, 'middleware');
        try { if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue; } catch { continue; }
        for (const file of _walk(dir)) {
            const baseName = path.basename(file);
            if (baseName === '_global.js') continue;
            try {
                const mod = require(file);
                const fileName = path.basename(file, path.extname(file));
                let name, handler;
                if (typeof mod === 'function') {
                    const maybe = mod.length <= 1 ? mod(ctx) : mod;
                    if (typeof maybe === 'function') { name = fileName; handler = maybe; }
                    else if (maybe && typeof maybe.handler === 'function') { name = maybe.name || fileName; handler = maybe.handler; }
                } else if (mod && typeof mod.create === 'function') {
                    const obj = mod.create(ctx);
                    if (obj && typeof obj.handler === 'function') { name = obj.name || fileName; handler = obj.handler; }
                } else if (mod && typeof mod.handler === 'function') {
                    name = mod.name || fileName; handler = mod.handler;
                }
                if (name && handler) { setMiddleware(name, handler); logger.info?.(`Registered middleware "${name}" from ${path.relative(process.cwd(), file)}`); loaded.push(name); }
                else logger.warn?.(`Skipped middleware (unrecognized export) at ${path.relative(process.cwd(), file)}`);
            } catch (e) { logger.warn?.(`Middleware load error for ${file}: ${e?.message}`); }
        }
    }
    return loaded;
}

/**
 * Loads global pre/post middleware stages from _global.js in appDirs.
 * @param {Array<string>} appDirs
 * @param {object} ctx
 * @param {object} logger
 * @returns {{pre: Array<Function>, post: Array<Function>}}
 */
function loadGlobalStages(appDirs, ctx, logger) {
    for (const base of appDirs) {
        const p = path.join(base, 'middleware', '_global.js');
        try {
            if (!fs.existsSync(p)) continue;
            const mod = require(p);
            const val = (typeof mod === 'function') ? mod(ctx) : mod;
            const pre = Array.isArray(val?.pre) ? val.pre : [];
            const post = Array.isArray(val?.post) ? val.post : [];
            logger.info?.(`Loaded global stages from ${path.relative(process.cwd(), p)} (pre:${pre.length}, post:${post.length})`);
            return { pre, post };
        } catch (e) {
            logger.warn?.(`Global middleware load error: ${e?.message}`);
        }
    }
    return { pre: [], post: [] };
}

module.exports = { loadAppMiddlewares, loadGlobalStages };
