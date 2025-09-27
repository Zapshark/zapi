'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

/**
 * Build the ordered list of .env files (low → high precedence) for a single dir.
 */
function _envFilesForDir(dir, nodeEnv, includeLocal, excludeLocalInTest) {
    const files = [];
    const add = (name) => {
        const p = path.join(dir, name);
        try { if (fs.existsSync(p)) files.push(p); } catch {}
    };

    add('.env.defaults');
    add('.env');

    const allowLocal = includeLocal && !(excludeLocalInTest && nodeEnv === 'test');
    if (allowLocal) add('.env.local');

    if (nodeEnv) {
        add(`.env.${nodeEnv}`);
        if (allowLocal) add(`.env.${nodeEnv}.local`);
    }
    return files;
}

/**
 * Returns absolute paths of present .env files in load order (low → high precedence).
 * If multiple searchPaths are provided, earlier paths are lower precedence;
 * later paths override earlier ones.
 *
 * @param {Object} o
 * @param {string[]} [o.searchPaths=[process.cwd(), path.join(process.cwd(),'src')]]
 * @param {string}   [o.nodeEnv=process.env.NODE_ENV]
 * @param {boolean}  [o.includeLocal=true]
 * @param {boolean}  [o.excludeLocalInTest=false]
 */
function detectEnvFiles({
                            searchPaths,
                            nodeEnv = process.env.NODE_ENV,
                            includeLocal = true,
                            excludeLocalInTest = false
                        } = {}) {
    const cwd = process.cwd();
    const defaults = [cwd, path.join(cwd, 'src')];
    const roots = (Array.isArray(searchPaths) && searchPaths.length ? searchPaths : defaults)
        .map(p => path.resolve(p));

    const ordered = [];
    for (const dir of roots) {
        ordered.push(..._envFilesForDir(dir, nodeEnv, includeLocal, excludeLocalInTest));
    }

    // dedupe while preserving last occurrence (so later paths win)
    const seen = new Set();
    const deduped = [];
    for (let i = ordered.length - 1; i >= 0; i--) {
        const f = ordered[i];
        if (!seen.has(f)) { seen.add(f); deduped.unshift(f); }
    }
    return deduped;
}

/**
 * Loads files in the order returned by detectEnvFiles (low → high precedence).
 *
 * @param {Object} o
 * @param {string[]} [o.searchPaths]
 * @param {string}   [o.nodeEnv]
 * @param {boolean}  [o.includeLocal=true]
 * @param {boolean}  [o.excludeLocalInTest=false]
 * @param {boolean}  [o.override=false]  // allow later .env to overwrite existing process.env
 * @param {boolean}  [o.verbose=true]
 */
function loadEnv({
                     searchPaths,
                     nodeEnv,
                     includeLocal = true,
                     excludeLocalInTest = false,
                     override = false,
                     verbose = true
                 } = {}) {
    const list = detectEnvFiles({ searchPaths, nodeEnv, includeLocal, excludeLocalInTest });
    const loaded = [];

    for (const file of list) {
        const res = dotenv.config({ path: file, override });
        if (!res.error) loaded.push(file);
    }

    if (verbose && loaded.length) {
        const names = loaded.map(p => path.relative(process.cwd(), p)).join(', ');
        console.log(`[env] loaded → ${names}`);
    }

    return { files: loaded };
}

module.exports = { detectEnvFiles, loadEnv };
