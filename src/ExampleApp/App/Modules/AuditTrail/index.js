'use strict';
const { Router } = require('express');

module.exports = (framework) => {
    const router = Router();
    const svc = framework.resolve('service', 'AuditService');

    router.get('/', async (_req, res, next) => {
        try {
            const list = await svc.list({ limit: 100 });
            res.json({ ok: true, count: list.length, data: list });
        } catch (e) { next(e); }
    });

    router.post('/', async (req, res, next) => {
        try {
            const { type = 'custom', payload = null, source = 'api' } = req.body || {};
            const evt = await svc.record(type, payload, source);
            res.status(201).json({ ok: true, data: evt });
        } catch (e) { next(e); }
    });

    // (Optional) Programmatic shutdown demonstration
    // Hit: POST /api/audittrail/shutdown  { "code": 0 }
    router.post('/shutdown', async (req, res) => {
        res.json({ ok: true, msg: 'Shutting down...' });
        // If your framework exposes shutdown(): await framework.shutdown({ code: req.body?.code ?? 0 });
        // Otherwise, rely on SIGINT/SIGTERM to trigger graceful path.
    });

    return router;
};
