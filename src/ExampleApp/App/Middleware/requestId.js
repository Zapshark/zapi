'use strict';
const { randomUUID } = require('crypto');

/**
 * Middleware: requestId
 * - Assigns a unique ID to every request.
 * - Exposes it on req.id and res.locals.requestId.
 * - Adds an `X-Request-Id` header to the response.
 */
module.exports = {
    name: 'requestId',
    description: 'Attach a unique request identifier (req.id + X-Request-Id header).',
    stage: 'pre',     // run before controllers
    auto: true,       // auto-apply globally
    priority: 5,      // run early
    handler: (req, res, next) => {
        const id = req.headers['x-request-id'] || randomUUID();
        req.id = id;
        res.locals.requestId = id;
        res.setHeader('X-Request-Id', id);
        next();
    }
};
