'use strict';

/**
 * EnvLoader — minimal, synchronous .env loader with a clear resolution order:
 *   1) options.envPath (file or directory)
 *   2) options.appDir/.env
 *   3) path.resolve(options.appDir, '..')/.env
 *
 * Usage:
 *   EnvLoader.load({ appDir: __dirname, envPath: '/abs/or/relative/path' });
 */
const fs = require('fs');
const path = require('path');

const EnvLoader = {
    /**
     * Load a .env file with lowest possible ceremony.
     * @param {object} opts
     * @param {string} opts.appDir                 - Absolute or relative directory of the App.
     * @param {string} [opts.envPath]              - Optional path; file or directory.
     * @param {boolean} [opts.override=false]      - If true, existing process.env keys will be overwritten.
     * @param {boolean} [opts.silent=false]        - If true, suppress console logs.
     * @returns {{loaded:boolean, file?:string, error?:Error}}
     */
    load({ appDir, envPath, override = false, silent = false } = {}) {
        const log = silent ? () => {} : console.log;
        const warn = silent ? () => {} : console.warn;

        // Resolve candidates in priority order
        const candidates = [];

        if (envPath) {
            const abs = path.resolve(envPath);
            if (fs.existsSync(abs)) {
                const stat = fs.statSync(abs);
                if (stat.isDirectory()) {
                    candidates.push(path.join(abs, '.env'));
                } else {
                    candidates.push(abs);
                }
            } else {
                warn(`[EnvLoader] Provided envPath does not exist: ${abs}`);
            }
        }

        const appDirAbs = path.resolve(appDir || process.cwd());
        candidates.push(path.join(appDirAbs, '.env'));
        candidates.push(path.join(path.resolve(appDirAbs, '..'), '.env'));

        // Pick first existing file
        let picked;
        for (const f of candidates) {
            try {
                if (f && fs.existsSync(f) && fs.statSync(f).isFile()) {
                    picked = f;
                    break;
                }
            } catch { /* ignore */ }
        }

        if (!picked) return { loaded: false };

        // Lazy require dotenv
        let dotenv;
        try { dotenv = require('dotenv'); }
        catch (err) {
            return { loaded: false, error: new Error('[EnvLoader] "dotenv" not installed. Run: npm i dotenv') };
        }

        const res = dotenv.config({ path: picked, override });
        if (res.error) return { loaded: false, file: picked, error: res.error };

        log(`[EnvLoader] Loaded .env from ${picked}`);
        return { loaded: true, file: picked };
    }
};

module.exports = EnvLoader;
