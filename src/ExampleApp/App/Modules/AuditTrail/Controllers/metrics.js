'use strict';
const { Router } = require('express');

module.exports = (framework) => {
    const router = Router();
    const svc = framework.resolve('service', 'AuditService');

    // Example: filter and basic counts
    router.get('/', async (_req, res, next) => {
        try {
            const last50 = await svc.list({ limit: 50 });
            const counts = last50.reduce((acc, e) => {
                acc[e.type] = (acc[e.type] || 0) + 1;
                return acc;
            }, {});
            res.json({ ok: true, window: 50, counts });
        } catch (e) { next(e); }
    });

    return router;
};
