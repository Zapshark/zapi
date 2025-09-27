// src/core/loader/RouteLoader.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Resolves a route file in given directories.
 * @param {Array<string>} dirs - Candidate directories.
 * @param {string} baseNameNoExt - Base file name without extension.
 * @returns {string|null} - Absolute path if found, else null.
 */
function resolveInDirs(dirs, baseNameNoExt) {
    const exts = ['.js', '.cjs', '.mjs'];
    for (const dir of dirs) for (const ext of exts) {
        const abs = path.join(dir, baseNameNoExt + ext);
        try { if (fs.existsSync(abs)) return abs; } catch {}
    }
    return null;
}

/**
 * Normalizes route prefix.
 * @param {string} p
 * @returns {string|null}
 */
function _normalizePrefix(p) {
    if (!p) return null;
    let s = String(p).trim();
    if (!s) return null;
    if (!s.startsWith('/')) s = '/' + s;
    return s.replace(/\/+$/, '');
}

/**
 * Normalizes version prefix.
 * @param {string} v
 * @returns {string|null}
 */
function _normalizeVersionPrefix(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (s.startsWith('/')) return s.replace(/\/+$/, '');
    const m = s.match(/^v?(\d+)(?:\..*)?$/i);
    return m ? `/v${m[1]}` : `/${s.replace(/^\/+|\/+$/g, '')}`;
}

/**
 * Normalizes route path.
 * @param {string} p
 * @returns {string}
 */
function _normalizeRoutePath(p) {
    const s = String(p || '/');
    return s.startsWith('/') ? s : '/' + s;
}

/**
 * Prepends segment to basePath if missing.
 * @param {string} basePath
 * @param {string} segment
 * @returns {string}
 */
function _prependIfMissing(basePath, segment) {
    if (!segment) return basePath;
    return basePath.startsWith(segment + '/') || basePath === segment
        ? basePath
        : `${segment}${basePath.startsWith('/') ? '' : '/'}${basePath}`;
}

/**
 * Composes mounted path for a route.
 * @param {object} route
 * @param {string|null} filePrefix
 * @param {string|null} fileVersion
 * @returns {object}
 */
function _composeMountedPath(route, filePrefix, fileVersion) {
    const pfx = _normalizePrefix(route.prefix ?? filePrefix);
    const ver = _normalizeVersionPrefix(route.version ?? fileVersion);
    let finalPath = _normalizeRoutePath(route.path || '/');
    if (ver) finalPath = _prependIfMissing(finalPath, ver);
    if (pfx) finalPath = _prependIfMissing(finalPath, pfx);
    return {
        path: finalPath,
        prefix: pfx || undefined,
        version: (route.version ?? fileVersion) || undefined
    };
}

/**
 * Applies mounting logic to all route definitions.
 * @param {Array<object>} routeDefs
 * @param {string|null} filePrefix
 * @param {string|null} fileVersion
 * @returns {Array<object>}
 */
function applyMounting(routeDefs, filePrefix, fileVersion) {
    return routeDefs.map(r => {
        const { path, prefix, version } = _composeMountedPath(r, filePrefix, fileVersion);
        return { ...r, path, prefix, version };
    });
}

/**
 * Loads and validates route definitions from appDirs.
 * @param {Array<string>} appDirs
 * @param {object} logger
 * @returns {Array<object>} - Array of mounted route definitions.
 * @throws {Error} - If no valid routes file found or invalid export.
 */
function loadRoutes(appDirs, logger) {
    const routesPath = resolveInDirs(appDirs, 'routes');
    if (!routesPath) throw new Error('Required host file missing: app/routes.(js|cjs|mjs)');
    logger.info?.(`Resolved routes file: ${routesPath}`);

    let exported;
    try {
        exported = require(routesPath);
    } catch (e) {
        logger.error?.(`Failed to require routes file: ${e?.message}`);
        throw new Error(`Failed to load routes: ${e?.message}`);
    }

    let val;
    try {
        val = (typeof exported === 'function')
            ? exported({})
            : exported;
    } catch (e) {
        logger.error?.(`Error executing routes factory: ${e?.message}`);
        throw new Error(`Routes factory error: ${e?.message}`);
    }

    let routeDefs, filePrefix = null, fileVersion = null;
    if (Array.isArray(val)) routeDefs = val;
    else if (val && Array.isArray(val.routes)) {
        routeDefs = val.routes;
        filePrefix = val.prefix ?? null;
        fileVersion = val.version ?? null;
    } else {
        logger.error?.('app/routes.* must export an array OR { routes:[...], prefix?, version? } OR a factory returning one of those');
        throw new Error('Invalid routes export');
    }

    routeDefs = applyMounting(routeDefs, filePrefix, fileVersion);
    logger.info?.(`Loaded ${routeDefs.length} route(s) from ${routesPath}`);
    return routeDefs;
}

module.exports = {
    loadRoutes,
    applyMounting,
    resolveInDirs
};
