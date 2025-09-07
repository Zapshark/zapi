'use strict';
/**
 * RouteDSL — attach route definitions to an Express.Router so ZapiFramework can read them.
 * Controllers keep returning an Express Router; this just tags it with metadata.
 */

const ROUTES_SYMBOL = Symbol.for('zapi.routes');

function toOperationId(method, path) {
    return `${method}_${path.replace(/[\/:{}-]+/g, '_')}`.replace(/^_+|_+$/g, '');
}

/**
 * Normalize one route definition.
 */
function normalize(def) {
    if (!def?.method) throw new Error('Route missing method');
    if (!def?.path) throw new Error('Route missing path');
    if (!def?.handler) throw new Error('Route missing handler');
    const method = String(def.method).toUpperCase();
    return {
        method,
        path: def.path,
        middlewares: def.middlewares || [],
        handler: def.handler,
        summary: def.summary,
        description: def.description,
        tags: def.tags || [],
        operationId: def.operationId || toOperationId(method, def.path),
        request: def.request || {},
        responses: def.responses || {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } }
        },
    };
}

/**
 * Attach an array of route defs to a router and wire the handlers.
 * Returns the same router for chaining/return.
 */
function attach(router, defs = []) {
    const normalized = defs.map(normalize);
    const bucket = router[ROUTES_SYMBOL] || (router[ROUTES_SYMBOL] = []);
    for (const r of normalized) {
        bucket.push(r);
        const method = r.method.toLowerCase();
        if (typeof router[method] !== 'function') throw new Error(`Unsupported HTTP method: ${r.method}`);
        const stack = [
            ...(r.middlewares || []),
            async (req, res, next) => {
                try {
                    const result = await r.handler(req, res, next);
                    if (!res.headersSent && result !== undefined) res.json(result);
                } catch (err) { next(err); }
            },
        ];
        router[method](r.path, ...stack);
    }
    return router;
}

/** Extract previously attached route defs from a router (if any). */
function getAttached(router) { return router[ROUTES_SYMBOL] || []; }

// Sugar creators for brevity inside modules:
const GET    = (path, meta, handler) => normalize({ ...(meta||{}), method: 'GET',    path, handler });
const POST   = (path, meta, handler) => normalize({ ...(meta||{}), method: 'POST',   path, handler });
const PUT    = (path, meta, handler) => normalize({ ...(meta||{}), method: 'PUT',    path, handler });
const PATCH  = (path, meta, handler) => normalize({ ...(meta||{}), method: 'PATCH',  path, handler });
const DELETE = (path, meta, handler) => normalize({ ...(meta||{}), method: 'DELETE', path, handler });

module.exports = { attach, getAttached, GET, POST, PUT, PATCH, DELETE, ROUTES_SYMBOL };
