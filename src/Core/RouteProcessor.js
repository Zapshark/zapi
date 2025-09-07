'use strict';
const { Router } = require('express');

/**
 * RouteProcessor
 * - Processes a manifest to generate Express routes and OpenAPI definitions.
 */
class RouteProcessor {
    /**
     * @param {object} framework - The framework instance.
     */
    constructor(framework) {
        if (!framework) throw new Error('[RouteProcessor] Framework instance is required');
        this.framework = framework;
    }

    /**
     * Processes a manifest to generate routes and OpenAPI definitions.
     * @param {object} manifest - The manifest object containing routes and metadata.
     * @returns {object} { router, openApi }
     */
    process(manifest) {
        const router = Router();
        const openApi = { paths: {}, tags: [] };

        if (manifest.routes) {
            for (const route of manifest.routes) {
                const {
                    method = 'get',
                    path,
                    handler,
                    summary = `Default summary for ${method.toUpperCase()} ${path}`,
                    tags = ['default'],
                    middlewares = [],
                    request = {},
                    responses = { 200: { description: 'OK' } },
                } = route;

                // Attach route to the router
                router[method.toLowerCase()](path, ...middlewares, async (req, res, next) => {
                    try {
                        const result = await handler(req, res);
                        if (result !== undefined) res.json(result);
                    } catch (err) {
                        next(err);
                    }
                });

                // Build OpenAPI path
                if (!openApi.paths[path]) openApi.paths[path] = {};
                openApi.paths[path][method.toLowerCase()] = {
                    summary,
                    tags,
                    requestBody: request.body ? {
                        content: {
                            'application/json': {
                                schema: request.body
                            }
                        }
                    } : undefined,
                    responses,
                };

                // Add tags to OpenAPI if not already present
                for (const tag of tags) {
                    if (!openApi.tags.find(t => t.name === tag)) {
                        openApi.tags.push({ name: tag, description: `${tag} operations` });
                    }
                }
            }
        }

        return { router, openApi };
    }
}

module.exports = RouteProcessor;
