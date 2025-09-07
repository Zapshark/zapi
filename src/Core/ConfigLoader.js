/* --- FILE: src\Core\ConfigLoader.js --- */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * ConfigLoader
 * Loads config JS files from <appRoot>/App/Config with dev-gating.
 *
 * Behavior:
 *  - If dev.Zapi.js exists: ONLY load files that start with "dev." (including dev.Zapi.js).
 *  - Otherwise: ONLY load files that do NOT start with "dev." (including Zapi.js).
 *
 * Registry keys:
 *  - Strip "dev." prefix when registering, so dev.MongoDB.js -> key "MongoDB", dev.Zapi.js -> "Zapi".
 *
 * Returns a map of { key -> object } and metadata for logging.
 */
const ConfigLoader = {
    /**
     * @param {object} p
     * @param {string} p.appRoot - absolute path to the app root (the folder that has /App)
     * @param {{info?:Function,warn?:Function,error?:Function}} [p.log]
     * @returns {{ entries: Map<string, any>, devMode: boolean, loadedFiles: string[], dir: string }}
     */
    load({ appRoot, log = console } = {}) {
        if (!appRoot) throw new Error('[ConfigLoader] appRoot is required');
        const configDir = path.join(appRoot, 'App', 'Config');
        const entries = new Map();

        if (!fs.existsSync(configDir) || !fs.statSync(configDir).isDirectory()) {
            log?.warn?.(`[ConfigLoader] No Config directory at ${configDir}`);
            return { entries, devMode: false, loadedFiles: [], dir: configDir };
        }

        const all = fs.readdirSync(configDir)
            .filter(f => f.endsWith('.js'))
            .sort();

        const hasDevZapi = all.includes('dev.Zapi.js');
        const filtered = all.filter(f => hasDevZapi ? f.startsWith('dev.') : !f.startsWith('dev.'));
        const devMode = hasDevZapi;

        const loadedFiles = [];
        for (const file of filtered) {
            const pth = path.join(configDir, file);
            // key = strip "dev." + strip ".js"
            const key = file.replace(/^dev\./, '').replace(/\.js$/i, '');
            try {
                // eslint-disable-next-line import/no-dynamic-require, global-require
                const mod = require(pth);
                const value = (typeof mod === 'function') ? mod() : mod;
                entries.set(key, value);
                loadedFiles.push(file);
            } catch (err) {
                log?.warn?.(`[ConfigLoader] Failed to load ${file}: ${err.message}`);
            }
        }


        return { entries, devMode, loadedFiles, dir: configDir };
    }
};

module.exports = ConfigLoader;
