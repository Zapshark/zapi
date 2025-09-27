'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const defaults = require('../config/default.js');

let configCache = null;

/* ---------- small utils ---------- */
function deepMerge(a, b) {
    const out = { ...(a || {}) };
    for (const k of Object.keys(b || {})) {
        const v = b[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(out[k] || {}, v);
        else out[k] = v;
    }
    return out;
}

function tryRequire(abs) {
    try {
        const mod = require(abs);
        return (mod && (mod.default || mod)) || null;
    } catch {
        return null;
    }
}

/**
 * Build candidate app/ directories to search for config/bootstrap/routes.
 * Priority (first wins):
 *  1) cfg.appDir (if provided via explicit override)
 *  2) ZAPI_APP_DIR env
 *  3) <dirname(require.main.filename)>/app   ← when you run node src/example/index.js
 *  4) CWD-based fallbacks:
 *     - ./app
 *     - ./src/app
 *     - ./example/app
 *     - ./src/example/app
 */
function appDirCandidates(explicitOverride) {
    const cwd = process.cwd();
    const envDir = process.env.ZAPI_APP_DIR && path.resolve(cwd, process.env.ZAPI_APP_DIR);
    const mainFile = require.main && require.main.filename;
    const mainDir = mainFile ? path.dirname(mainFile) : null;
    const fromCfg = explicitOverride && explicitOverride.appDir ? path.resolve(cwd, explicitOverride.appDir) : null;

    const cand = [];
    if (fromCfg) cand.push(fromCfg);
    if (envDir)  cand.push(envDir);
    if (mainDir) cand.push(path.join(mainDir, 'app'));

    cand.push(
        path.join(cwd, 'app'),
        path.join(cwd, 'src', 'app'),
        path.join(cwd, 'example', 'app'),
        path.join(cwd, 'src', 'example', 'app')
    );

    // unique, existing dirs only
    const seen = new Set();
    const out = [];
    for (const p of cand) {
        const abs = path.resolve(p);
        if (seen.has(abs)) continue;
        seen.add(abs);
        try { if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) out.push(abs); } catch {}
    }
    return out;
}

function resolveFileWithExt(baseNoExt) {
    const names = [`${baseNoExt}.js`, `${baseNoExt}.cjs`, `${baseNoExt}.mjs`];
    for (const n of names) {
        try { if (fs.existsSync(n)) return n; } catch {}
    }
    return null;
}

/* ---------- .env loader (root + src + optional extra) ---------- */
function detectEnvFiles({ searchPaths, nodeEnv = process.env.NODE_ENV, includeLocal = true } = {}) {
    const cwd = process.cwd();
    const roots = (Array.isArray(searchPaths) && searchPaths.length ? searchPaths : [cwd, path.join(cwd, 'src')])
        .map(p => path.resolve(p));

    const list = [];
    const addSet = (dir) => {
        const allowLocal = includeLocal && nodeEnv !== 'test';
        const add = (name) => {
            const f = path.join(dir, name);
            try { if (fs.existsSync(f)) list.push(f); } catch {}
        };
        add('.env.defaults'); add('.env');
        if (allowLocal) add('.env.local');
        if (nodeEnv) {
            add(`.env.${nodeEnv}`);
            if (allowLocal) add(`.env.${nodeEnv}.local`);
        }
    };
    for (const dir of roots) addSet(dir);

    // dedupe while preserving precedence (later is higher)
    const seen = new Set();
    const out = [];
    for (let i = list.length - 1; i >= 0; i--) {
        if (!seen.has(list[i])) { seen.add(list[i]); out.unshift(list[i]); }
    }
    return out;
}

function loadEnvOnce() {
    const cwd = process.cwd();
    const extra = process.env.ZAPI_ENV_PATHS
        ? process.env.ZAPI_ENV_PATHS.split(',').map(p => path.resolve(cwd, p.trim()))
        : [];
    const files = detectEnvFiles({ searchPaths: [cwd, path.join(cwd, 'src'), ...extra] });
    const loaded = [];
    for (const f of files) {
        const res = dotenv.config({ path: f, override: false }); // don’t clobber existing env
        if (!res.error) loaded.push(f);
    }
    if (loaded.length) {
        const rel = loaded.map(p => path.relative(cwd, p)).join(', ');
        console.log(`[env] loaded → ${rel}`);
    }
}

/* ---------- host config loader (auto: app/config/app.* from candidates) ---------- */
function loadHostConfig(explicitOverride) {
    const bases = appDirCandidates(explicitOverride);
    for (const base of bases) {
        const candidate = resolveFileWithExt(path.join(base, 'config', 'app'));
        if (candidate) {
            const cfg = tryRequire(candidate);
            if (cfg) return cfg;
        }
    }
    return {};
}

/* ---------- public API ---------- */
function loadConfig(explicitOverride) {
    // 1) env
    loadEnvOnce();

    // 2) defaults ← host app/config/app.* ← explicit override (optional)
    const host = loadHostConfig(explicitOverride);
    configCache = deepMerge(defaults || {}, host || {});
    if (explicitOverride) configCache = deepMerge(configCache, explicitOverride);

    // expose detected appDir for workers (first candidate used)
    const bases = appDirCandidates(explicitOverride);
    if (bases.length && !configCache.appDir) configCache.appDir = bases[0];

    return configCache;
}

function getConfig() {
    if (!configCache) return loadConfig();
    return configCache;
}

function setConfig(next) { configCache = next || {}; }

module.exports = {
    loadConfig, getConfig, setConfig,
    deepMerge,
    // exposed for tests/power-users
    appDirCandidates
};
