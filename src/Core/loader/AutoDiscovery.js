'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { setService, resolveService } = require('../registry/services');
const { setController, resolveController } = require('../registry/controllers');
// ensure core MonitoringService exists (config-togglable)
function ensureCoreMonitoring(cfg, log) {
    try {
        const { hasService, setService } = require('../registry/services');
        if (cfg?.zapi?.monitoring?.enable === false) return; // toggle off
        if (hasService && hasService('MonitoringService')) return; // already constructed
        const CoreMonitoringService = require('../monitoring/MonitoringService');
        // constructing auto-registers it into the services registry
        const instance = new CoreMonitoringService();
        setService && setService('MonitoringService', instance);
        log?.info?.('[autodiscover] core MonitoringService enabled');
    } catch (e) {
        log?.warn?.(`[autodiscover] core MonitoringService failed: ${e?.message}`);
    }
}

function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function isDir(p)  { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function walk(dir, out = []) {
    if (!isDir(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        if (isDir(abs)) walk(abs, out);
        else if (name.endsWith('.js') && !name.endsWith('.test.js') && !name.endsWith('.spec.js')) out.push(abs);
    }
    return out;
}

function inferNameFromClass(ctor, fallback) {
    if (!ctor) return fallback;
    if (typeof ctor.artifactName === 'string') return ctor.artifactName;
    if (typeof ctor.name === 'string' && ctor.name) return ctor.name;
    return fallback;
}

function loadService(file, ctx) {
    try {
        const mod = require(file);
        let instance, name;

        if (typeof mod?.create === 'function') {
            const res = mod.create(ctx);
            if (res && typeof res === 'object' && 'instance' in res) {
                name = res.name || inferNameFromClass(res.instance?.constructor, path.basename(file, '.js'));
                instance = res.instance;
            } else {
                instance = res;
                name = inferNameFromClass(instance?.constructor, path.basename(file, '.js'));
            }
        } else if (typeof mod === 'function') {
            name = inferNameFromClass(mod, path.basename(file, '.js'));
            instance = new mod(ctx);
        } else if (typeof mod?.default === 'function') {
            name = inferNameFromClass(mod.default, path.basename(file, '.js'));
            instance = new mod.default(ctx);
        } else if (mod?.Service && typeof mod.Service === 'function') {
            name = inferNameFromClass(mod.Service, path.basename(file, '.js'));
            instance = new mod.Service(ctx);
        }

        if (!instance) return { ok: false, reason: 'no-constructible' };
        setService(name, instance);
        return { ok: true, name };
    } catch (e) {
        return { ok: false, error: e };
    }
}

function loadController(file, ctx) {
    try {
        const mod = require(file);
        let instance, name;

        if (typeof mod?.create === 'function') {
            const res = mod.create(ctx);
            if (res && typeof res === 'object' && 'instance' in res) {
                name = res.name || inferNameFromClass(res.instance?.constructor, path.basename(file, '.js'));
                instance = res.instance;
            } else {
                instance = res;
                name = inferNameFromClass(instance?.constructor, path.basename(file, '.js'));
            }
        } else if (typeof mod === 'function') {
            name = inferNameFromClass(mod, path.basename(file, '.js'));
            instance = new mod(ctx);
        } else if (typeof mod?.default === 'function') {
            name = inferNameFromClass(mod.default, path.basename(file, '.js'));
            instance = new mod.default(ctx);
        } else if (mod?.Controller && typeof mod.Controller === 'function') {
            name = inferNameFromClass(mod.Controller, path.basename(file, '.js'));
            instance = new mod.Controller(ctx);
        }

        if (!instance) return { ok: false, reason: 'no-constructible' };
        setController(name, instance);
        return { ok: true, name, instance };
    } catch (e) {
        return { ok: false, error: e };
    }
}

function loadRoutes(file, helpers) {
    let defs = null;
    try {
        const mod = require(file);
        defs = (typeof mod === 'function')
            ? mod(helpers)
            : (typeof mod?.default === 'function')
                ? mod.default(helpers)
                : (Array.isArray(mod) ? mod : (Array.isArray(mod?.default) ? mod.default : null));
        if (!Array.isArray(defs)) return { ok: false, reason: 'not-array' };
        return { ok: true, routes: defs };
    } catch (e) {
        return { ok: false, error: e };
    }
}

/**
 * Auto-discover artifacts in the host app.
 * @param {object} o
 * @param {object} o.cfg
 * @param {object} o.cache
 * @param {object} o.logger
 * @returns {Promise<{routes:any[], services:string[], controllers:string[]}>}
 */
async function autoDiscover({ cfg, cache, logger }) {
    const log = logger || console;
    const cwd = process.cwd();
    const opt = cfg.autoDiscover || {};
    const roots = (opt.paths && opt.paths.length) ? opt.paths : ['app'];

    const dir = {
        services: opt.servicesDir || 'services',
        controllers: opt.controllersDir || 'controllers',
        models: opt.modelsDir || 'models',
        routes: opt.routesDir || 'routes',
    };

    const joinMany = (sub) => roots.map(r => path.join(cwd, r, sub));

    // 1) models
    for (const root of joinMany(dir.models)) {
        const files = walk(root);
        for (const f of files) {
            try { require(f); log.info?.(`[autodiscover] model: ${path.relative(cwd, f)}`); }
            catch (e) { log.warn?.(`[autodiscover] model failed: ${path.relative(cwd, f)} → ${e?.message}`); }
        }
    }

    // DI context for services/controllers
    const ctx = { cache, config: cfg, resolveService, resolveController };
// make sure core MonitoringService is present (respects zapi.monitoring.enable)
    ensureCoreMonitoring(cfg, log);

    const servicesLoaded = [];
    for (const root of joinMany(dir.services)) {
        const files = walk(root);
        for (const f of files) {
            const r = loadService(f, ctx);
            if (r.ok) { servicesLoaded.push(r.name); log.info?.(`[autodiscover] service: ${r.name}`); }
            else      { log.warn?.(`[autodiscover] service skipped: ${path.relative(cwd, f)} (${r.reason || r.error?.message})`); }
        }
    }

    const controllersLoaded = [];
    for (const root of joinMany(dir.controllers)) {
        const files = walk(root);
        for (const f of files) {
            const r = loadController(f, ctx);
            if (r.ok) { controllersLoaded.push(r.name); log.info?.(`[autodiscover] controller: ${r.name}`); }
            else      { log.warn?.(`[autodiscover] controller skipped: ${path.relative(cwd, f)} (${r.reason || r.error?.message})`); }
        }
    }

    // 4) routes
    const allRoutes = [];
    const helpers = { resolveService, resolveController };
    for (const root of joinMany(dir.routes)) {
        const files = walk(root);
        for (const f of files) {
            const r = loadRoutes(f, helpers);
            if (r.ok) { allRoutes.push(...r.routes); log.info?.(`[autodiscover] routes: ${path.relative(cwd, f)} (+${r.routes.length})`); }
            else      { log.warn?.(`[autodiscover] routes skipped: ${path.relative(cwd, f)} (${r.reason || r.error?.message})`); }
        }
    }

    return { routes: allRoutes, services: servicesLoaded, controllers: controllersLoaded };
}

module.exports = { autoDiscover };
