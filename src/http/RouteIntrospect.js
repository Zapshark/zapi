'use strict';

const { listControllers, resolveController } = require('../core/registry/controllers');

/** Internal: reflect which controller owns a given bound handler function. */
function guessOwner(handler) {
    try {
        for (const name of listControllers()) {
            const inst = resolveController(name);
            // bound methods are own enumerable props on the instance
            for (const key of Object.keys(inst)) {
                const val = inst[key];
                if (typeof val === 'function' && val === handler) {
                    return { controller: name, action: key };
                }
            }
        }
    } catch {
        // ignore registry errors
    }
    return null;
}

function _describe(defs) {
    const out = (defs || []).map(r => {
        const method = String(r.method || 'get').toUpperCase();
        const path = String(r.path || '/');
        const owner = guessOwner(r.handler);
        const description = String(r.description || '');
        const entry = {
            description,
            method,
            path,
            handler:
                owner ? `${owner.controller}.${owner.action}` :
                    (r.handler && r.handler.name) ? r.handler.name : '<anonymous>',
            middleware: r.middleware || [],
            prefix: r.prefix || undefined,
            version: r.version || undefined
        };
        if (owner) { entry.controller = owner.controller; entry.action = owner.action; }
        return entry;
    });
    out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    return out;
}

/**
 * describeRoutes:
 *  - describeRoutes(routeDefs:Array) -> Array<Summary>
 *  - describeRoutes() -> Express handler (req,res) that returns { routes, count }
 *
 * The handler version reads the canonical route list from req.app.locals.__zapi_routes,
 * which buildRouter() publishes.
 */
function describeRoutes(routeDefs) {
    if (Array.isArray(routeDefs)) {
        return _describe(routeDefs);
    }
    // handler mode
    return async function routeIndexHandler(req, res) {
        const defs = req?.app?.locals?.__zapi_routes || [];
        res.json({ routes: _describe(defs), count: defs.length });
    };
}

/**
 * Convenience: append GET <path> to the provided routeDefs that serves the index.
 */
function withRouteIndex(routeDefs, opts = {}) {
    const indexPath = opts.path || '/_routes';
    return [...routeDefs, { path: indexPath, method: 'get', handler: describeRoutes() }];
}

module.exports = { describeRoutes, withRouteIndex };
