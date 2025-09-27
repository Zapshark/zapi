'use strict';
const express = require('express');
const { requireBackendKey } = require('./ApiBackendAuth');
const { resolveService } = require('../registry/services');

function buildRouter(cfg) {
    const r = express.Router();
    r.use(requireBackendKey(cfg));

    // Health: from HealthService
    r.get('/health', (_req) => {
        const Health = resolveService('HealthService');
        return Health?.getState?.() || { status: 'Ok', meta: {} };
    });

    // Current worker’s WS connections (count + light detail)
    r.get('/ws', (_req) => {
        const Bus = resolveService('BusService');
        const wss = Bus?.wss;
        const out = { count: 0, clients: [] };
        if (wss?.clients) {
            wss.clients.forEach((ws) => {
                out.count++;
                // note: ws.meta is set in example ws handler (ip/rooms)
                const ip = ws?.meta?.ip || null;
                const rooms = Array.from(ws?.meta?.rooms || []);
                out.clients.push({ ip, rooms });
            });
        }
        return out;
    });

    // Latest leader snapshots captured in BackendStateService
    r.get('/system', (_req) => {
        const S = resolveService('BackendStateService');
        return S?.getLatest?.() || { heartbeat: null, metrics: null };
    });

    // Simple ping
    r.get('/ping', (_req) => ({ ok: true, ts: Date.now() }));

    return r;
}

module.exports = { buildRouter };
