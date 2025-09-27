'use strict';

const express = require('express');
const { resolveMiddleware } = require('../core/registry/middleware');

/**
 * Normalize a mixed list of middleware names/functions into functions.
 * - strings => resolved via middleware registry
 * - functions => used as-is
 */
function normalizeChain(entries = []) {
    const out = [];
    for (const m of entries) {
        if (!m) continue;
        if (typeof m === 'function') { out.push(m); continue; }
        if (typeof m === 'string') {
            const fn = resolveMiddleware(m);
            if (typeof fn !== 'function') throw new Error(`[middleware] Unknown middleware "${m}"`);
            out.push(fn);
            continue;
        }
        throw new Error('[middleware] entries must be string names or functions');
    }
    return out;
}

/**
 * Run a chain of middlewares with (req,res,next) semantics, but **without** mutating headers/body.
 * We call these after the response is finished; they’re for logging/metrics only.
 */
function runPostChain(chain, req, res) {
    let idx = 0;
    function next(err) {
        if (err) {
            // We can’t surface this error to the client now; just log and stop.
            try { console.error('[post-stage]', err); } catch {}
            return;
        }
        const fn = chain[idx++];
        if (!fn) return;
        try {
            // Provide a no-op "next" that just advances the chain
            fn(req, res, next);
        } catch (e) {
            try { console.error('[post-stage]', e); } catch {}
            // stop the chain on error
        }
    }
    next();
}

/**
 * buildRouter(routeDefs, options?)
 *  - routeDefs: { path, method, handler, [description], [prefix], [version], [middleware] }[]
 *  - options.globalPre:  string|function[]  (runs before all routes)
 *  - options.globalPost: string|function[]  (runs after response is finished)
 */
function buildRouter(routeDefs = [], options = {}) {
    const router = express.Router();
    const { globalPre = [], globalPost = [] } = options;

    const preChain = normalizeChain(globalPre);
    const postChain = normalizeChain(globalPost); // will run on res.finish / res.close

    // Normalize once so introspection is stable
    const defs = routeDefs.map(r => ({
        path: r.path || '/',
        method: String(r.method || 'get').toLowerCase(),
        handler: r.handler,
        description: r.description || '',
        middleware: Array.isArray(r.middleware) ? r.middleware
            : Array.isArray(r.middlewares) ? r.middlewares
                : r.middleware ? [r.middleware] : [],
        prefix: r.prefix || undefined,
        version: r.version || undefined,
    }));

    // Publish canonical list for describeRoutes()
    router.use((req, _res, next) => {
        if (!req.app.locals) req.app.locals = {};
        req.app.locals.__zapi_routes = req.app.locals.__zapi_routes || defs;
        next();
    });

    // Attach a “post-stage trigger” once per request so globalPost runs after the response.
    if (postChain.length) {
        router.use((req, res, next) => {
            let fired = false;
            const fire = () => {
                if (fired) return;
                fired = true;
                // Execute after a tick to ensure Express has fully flushed.
                setImmediate(() => runPostChain(postChain, req, res));
            };
            res.once('finish', fire);
            res.once('close', fire);
            next();
        });
    }

    // Global PRE (before all routes)
    if (preChain.length) router.use(...preChain);

    // Wire each route
    for (const r of defs) {
        const method = typeof router[r.method] === 'function' ? r.method : 'get';
        const routeChain = normalizeChain(r.middleware);

        router[method](r.path, ...routeChain, async (req, res, next) => {
            try {
                const out = await r.handler(req, res, next);
                if (out !== undefined && !res.headersSent) res.json(out);
                // do NOT call next() here unconditionally; the post stage is attached globally via finish/close
            } catch (err) {
                next(err);
            }
        });
    }



    // Catch-all 404 (must be BEFORE the error handler)
    router.use((req, res, next) => {
        if (res.headersSent) return next(); // nothing we can do
        const status = 404;
        const err = new Error('Not Found');
        err.code = 'ROUTE_NOT_FOUND';

        // If shapeResponse is active, let it build the envelope
        if (typeof res.locals?._shapeWrapError === 'function') {
            return res.status(status).json(res.locals._shapeWrapError(err, status));
        }

        // Fallback: honor a configured status key if available; default to "ok"
        const statusKey = (req.app?.locals?.config?.shapeKey) || 'ok';
        return res.status(status).json({
            [statusKey]: false,
            error: {
                code: err.code,
                message: err.message,
                path: req.originalUrl,
                method: req.method
            }
        });
    });

    // Error handler (last). If headers already sent, delegate to Express default.
    router.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        const status = err.statusCode || err.status || 500;

        // Use shapeResponse if present
        if (typeof res.locals?._shapeWrapError === 'function') {
            return res.status(status).json(res.locals._shapeWrapError(err, status));
        }

        // Fallback minimal envelope
        const statusKey = (req.app?.locals?.config?.shapeKey) || 'ok';
        return res.status(status).json({
            [statusKey]: false,
            error: { code: String(status), message: err.message || 'Internal Server Error' }
        });
    });

    return router;
}



module.exports = { buildRouter };
