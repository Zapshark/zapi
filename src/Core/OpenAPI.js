'use strict';

function inferSchema(v) {
    if (Array.isArray(v)) return { type: 'array', items: v.length ? inferSchema(v[0]) : {} };
    switch (typeof v) {
        case 'string':  return { type: 'string' };
        case 'number':  return { type: 'number' };
        case 'boolean': return { type: 'boolean' };
        case 'object':  return toSchema(v);
        default:        return { type: 'string' };
    }
}

function toSchema(maybe) {
    if (!maybe || typeof maybe !== 'object') return { type: 'object' };
    if (maybe.type || maybe.$ref) return maybe;
    const properties = {};
    const required = [];
    for (const [k, v] of Object.entries(maybe)) {
        properties[k] = inferSchema(v);
        required.push(k);
    }
    return { type: 'object', properties, required };
}

function buildOpenAPI({ info, servers, routes }) {
    const doc = {
        openapi: '3.1.0',
        info: info || { title: 'ZAPI', version: '0.1.0' },
        servers: (servers && servers.length ? servers : [{ url: '/' }]),
        paths: {},
        components: { schemas: {}, securitySchemes: {} },
        tags: [],
    };
    const tagSet = new Set();

    for (const r of routes) {
        if (!doc.paths[r.path]) doc.paths[r.path] = {};
        const op = {
            operationId: r.operationId,
            summary: r.summary,
            description: r.description,
            tags: r.tags?.length ? r.tags : undefined,
            parameters: [],
            requestBody: undefined,
            responses: {},
        };
        (r.tags || []).forEach(t => tagSet.add(t));

        const req = r.request || {};
        const groups = [
            ['params',  'path'],
            ['query',   'query'],
            ['headers', 'header'],
            ['cookie',  'cookie'],
        ];
        for (const [k, loc] of groups) {
            const o = req[k];
            if (!o) continue;
            const schema = toSchema(o);
            const props = schema.properties || {};
            for (const name of Object.keys(props)) {
                op.parameters.push({ name, in: loc, required: (schema.required||[]).includes(name), schema: props[name] });
            }
        }
        if (req.body) {
            op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(req.body) } } };
        }

        const resp = r.responses || {};
        for (const code of Object.keys(resp)) {
            const entry = resp[code];
            op.responses[code] = {
                description: entry.description || 'Response',
                content: entry.content || { 'application/json': { schema: { type: 'object' } } },
            };
        }
        doc.paths[r.path][r.method.toLowerCase()] = op;
    }

    if (tagSet.size) doc.tags = Array.from(tagSet).map(name => ({ name }));
    return doc;
}

module.exports = { buildOpenAPI };
