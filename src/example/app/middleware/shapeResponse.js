// app/middleware/shapeResponse.js
module.exports = ({ config } = {}) => function shapeResponse(req, res, next) {
    if (res.locals.noShape === true) return next();

    const startedAt = Date.now();
    res.locals.meta = res.locals.meta || {};
    res.locals.meta.requestId = res.locals.meta.requestId || req.headers['x-request-id'];

    // Determine what key to use for status (default = "ok")
    const statusKey = (config && config.shapeKey) || 'ok';

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const buildMeta = () => ({
        ...res.locals.meta,
        durationMs: Date.now() - startedAt,
        path: req.originalUrl,
        method: req.method,
    });

    res.json = function jsonShaped(body) {
        if (res.locals.noShape === true) return originalJson(body);
        // If already shaped, don't wrap again
        if (body && typeof body === 'object' && (statusKey in body)) {
            return originalJson(body);
        }
        return originalJson({
            [statusKey]: true,   // 👈 dynamic key
            data: body ?? null,
            meta: buildMeta()
        });
    };

    res.send = function sendMaybeJson(body) {
        if (res.locals.noShape === true) return originalSend(body);
        if (typeof body === 'object' && body !== null) return res.json(body);
        return originalSend(body);
    };

    res.locals._shapeWrapError = function wrapError(err, status) {
        return {
            [statusKey]: false,  // 👈 dynamic key
            error: {
                code: err.code || String(status || 500),
                message: err.message || 'Internal Server Error',
                details: err.details || undefined
            },
            meta: buildMeta()
        };
    };

    next();
};
