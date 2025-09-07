/* --- FILE: src/Core/MiddlewareLoader.js --- */
'use strict';
const fs = require('fs');
const path = require('path');

function _isDir(p) { try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; } }
function _isFile(p) { try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; } }

function _normalize(entry, file) {
    if (!entry) throw new Error(`Invalid middleware in ${file}`);
    const obj = (typeof entry === 'function') ? entry : () => entry; // factory(framework) -> { ... }
    return obj;
}

const MiddlewareLoader = {
    /**
     * Scans <appRoot>/App/Middleware for *.js and registers them at kind 'middleware'.
     * Supports:
     *   - module.exports = { name, description, handler, stage?, auto?, priority? }
     *   - module.exports = (framework) => ({ ...same })
     *
     * Registry entry shape:
     *   key: name
     *   value: { name, description, handler, stage: 'pre'|'post', auto: boolean, priority: number, sourceFile: string }
     */
    load({ framework, appRoot, log = console }) {
        if (!framework) throw new Error('[MiddlewareLoader] requires { framework }');
        if (!appRoot) throw new Error('[MiddlewareLoader] requires { appRoot }');

        const dir = path.join(appRoot, 'App', 'Middleware');
        if (!_isDir(dir)) {
            log?.info?.(`[MiddlewareLoader] No Middleware directory at ${dir}`);
            return { count: 0, dir };
        }

        const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
        let count = 0;

        for (const f of files) {
            const abs = path.join(dir, f);
            if (!_isFile(abs)) continue;

            let mod;
            try { mod = require(abs); }
            catch (err) { log?.warn?.(`[MiddlewareLoader] Failed to require ${f}: ${err.message}`); continue; }

            const make = _normalize(mod, abs);
            let def;
            try { def = make(framework); }
            catch (err) { log?.warn?.(`[MiddlewareLoader] Factory threw for ${f}: ${err.message}`); continue; }

            if (!def?.handler || typeof def.handler !== 'function') {
                log?.warn?.(`[MiddlewareLoader] ${f} missing handler()`);
                continue;
            }
            if (!def?.name || typeof def.name !== 'string') {
                log?.warn?.(`[MiddlewareLoader] ${f} missing name`);
                continue;
            }

            const entry = {
                name: def.name,
                description: def.description || '',
                handler: def.handler,
                stage: (def.stage === 'post' ? 'post' : 'pre'),
                auto: Boolean(def.auto),
                priority: Number.isFinite(def.priority) ? def.priority : 100,
                sourceFile: abs,
            };

            framework.register('middleware', entry.name, entry);
            count++;
        }

        log?.info?.(`[MiddlewareLoader] Loaded ${count} middleware(s) from ${dir}`);
        return { count, dir };
    }
};

module.exports = MiddlewareLoader;
