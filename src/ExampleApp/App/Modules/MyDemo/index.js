'use strict';
const { Router } = require('express');
const { attach, GET, POST } = require('zapi').RouteDSL;
const { mw } = require('zapi'); // helper to fetch middleware by name: mw(framework, 'name')

module.exports = (framework) => {
    const router = Router();

    /**
     * @type {import('./Services/MyDataService').MyDataService}
     * @description Example service to access demo data.
     *              See src/ExampleApp/App/Modules/MyDemo/Services/MyDataService.js
     */
    const service = framework.resolve('service', 'MyDataService');

    // ─────────────────────────────────────────────────────────────
    // Controller-level middleware (applies to every route here)
    // Examples assume you created App/Middleware/requestId.js and cors.js
    // router.use(framework.middleware('cors'));           // alternative without `mw` helper
    router.use(mw(framework, 'requestId'));               // adds req.id (for example)
    router.use(mw(framework, 'cors'));                    // enable CORS on this controller
    // ─────────────────────────────────────────────────────────────

    router.get('/list', async (_req, res, next) => {
        try {
            res.status(200).json({ ok: true, data: await service.listAll() });
        } catch (e) {
            next(e);
        }
    });

    attach(router, [

        GET('/id/:id', {
            summary: 'Get a demo document by ID',
            tags: ['mydemo'],
            middlewares: [mw(framework, 'auth')], // Add auth middleware if needed
            parameters: [
                {
                    name: 'id',
                    in: 'path',
                    required: true,
                    schema: { type: 'string' },
                    description: 'The ID of the demo document to retrieve'
                }
            ],
            responses: {
                200: { description: 'OK' },
                404: { description: 'Not Found' }
            }
        }, async (req, res) => {
            const { id } = req.params;
            const doc = await service.getById(id);
            if (!doc) {
                res.status(404).json({ ok: false, error: 'Document not found' });
                return;
            }
            res.status(200).json({ ok: true, data: doc });
        }),


        GET('/', {
            summary: 'List all demo documents',
            tags: ['mydemo'],
            // Route-level middleware (only this endpoint):
            // e.g., protect reads: auth, or add a per-route rate limiter
            middlewares: [ mw(framework, 'auth') ],
            responses: {
                200: {
                    description: 'OK',
                    content: { 'application/json': { schema: { type: 'object' } } }
                }
            }
        }, async (req, res) => {
            res.status(200).json({ ok: true, data: await service.listAll() });

        }),

        // POST /api/mydemo
        POST('/', {
            summary: 'Create a demo document',
            tags: ['mydemo'],
            // Maybe POST requires auth while GET is public? Flip as you like.
            middlewares: [ mw(framework, 'auth') ],
            request: {
                body: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        description: { type: 'string' },
                        tags: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['title']
                }
            },
            responses: { 201: { description: 'Created' } }
        }, async (req, res) => {
            const { title, description, tags } = req.body || {};
            const doc = await service.create({title, description, tags});
            res.status(200).json({ ok: true, data: doc });
        }),
    ]);
    return router;
};
