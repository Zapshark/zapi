/* --- FILE: src\Core\BackendManagement.js --- */
'use strict';

const { Router } = require('express');
const BaseArtifact = require('./BaseArtifact');

function redact(obj) {
    const S = (k) => /pass(word)?|secret|token|api[_-]?key|auth|credential/i.test(k);
    if (!obj || typeof obj !== 'object') return obj;
    const out = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = (S(k))
            ? (typeof v === 'string' && v ? '•••' + v.slice(-2) : '•••')
            : (v && typeof v === 'object' ? redact(v) : v);
    }
    return out;
}

class BackendManagement extends BaseArtifact {
    static kind = 'service';

    constructor({ framework, name = 'BackendManagement' } = {}) {
        super({ framework, name });
        const router = (this.router = Router());

        router.get('/', (_req, res) => {
            res.json({
                ok: true,
                app: this.framework.config?.name || 'ZapiApp',
                endpoints: ['.', 'info', 'registries', 'config', 'models', 'registries/modelSchemas?q=<text>']
            });
        });

        router.get('/info', (_req, res) => {
            const ctlBuckets = this.framework.registries.get('controllerFactories') || new Map();
            res.json({
                ok: true,
                app: this.framework.config?.name || 'ZapiApp',
                http: { mounted: !!this.framework._mounted },
                counts: {
                    modules: (this.framework.registries.get('module') || new Map()).size,
                    services: (this.framework.registries.get('service') || new Map()).size,
                    repositories: (this.framework.registries.get('repository') || new Map()).size,
                    controllers: (this.framework.registries.get('controller') || new Map()).size,
                    controllerFactories: ctlBuckets.size,
                    configs: (this.framework.registries.get('config') || new Map()).size
                }
            });
        });

        // Show all registry kinds + keys
        router.get('/registries', (_req, res) => {
            const kinds = {};
            for (const [kind, bucket] of this.framework.registries.entries()) {
                kinds[kind] = Array.from(bucket.keys());
            }
            res.json({ ok: true, registries: kinds });
        });

        // Redacted config dump + meta
        router.get('/config', (_req, res) => {
            const bucket = this.framework.registries.get('config') || new Map();
            const cfg = {};
            for (const [k, v] of bucket.entries()) cfg[k] = redact(v);
            res.json({ ok: true, config: cfg, meta: this.framework.get('configMeta') || null });
        });

        // Models summary (quick glance)
        router.get('/models', (_req, res) => {
            const bucket = this.framework.registries.get('modelSchemas') || new Map();
            const out = {};
            for (const [k, v] of bucket.entries()) {
                out[k] = {
                    name: v?.name,
                    connection: v?.connection,
                    collection: v?.collection || v?.schema?.options?.collection || null,
                    paths: v?.schema ? Object.keys(v.schema.paths) : []
                };
            }
            res.json({ ok: true, count: Object.keys(out).length, models: out, meta: this.framework.get('modelMeta') || null });
        });

        /**
         * Filterable modelSchemas list:
         *   GET /registries/modelSchemas?q=default:   (substring match)
         * Extra filters:
         *   - ?startsWith=default:   (prefix match)
         *   - ?exact=User            (exact key)
         *   - ?conn=default          (match entry.connection)
         */
        router.get('/registries/modelSchemas', (req, res) => {
            const bucket = this.framework.registries.get('modelSchemas') || new Map();
            const q = (req.query.q ?? '').toString();
            const startsWith = (req.query.startsWith ?? '').toString();
            const exact = (req.query.exact ?? '').toString();
            const conn = (req.query.conn ?? '').toString();

            const keys = Array.from(bucket.keys());
            let filtered = keys;

            if (exact) {
                filtered = filtered.filter(k => k === exact);
            } else if (startsWith) {
                filtered = filtered.filter(k => k.startsWith(startsWith));
            } else if (q) {
                const needle = q.toLowerCase();
                filtered = filtered.filter(k => k.toLowerCase().includes(needle));
            }

            if (conn) {
                filtered = filtered.filter(k => {
                    const v = bucket.get(k);
                    return v?.connection === conn;
                });
            }

            const results = {};
            for (const k of filtered) {
                const v = bucket.get(k);
                results[k] = {
                    name: v?.name,
                    connection: v?.connection,
                    collection: v?.collection || v?.schema?.options?.collection || null
                };
            }

            res.json({ ok: true, total: keys.length, matched: filtered.length, results });
        });
    }

    getRouter() { return this.router; }
}

module.exports = BackendManagement;
