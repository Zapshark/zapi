'use strict';

const os = require('node:os');
const { getConfig } = require('../Config');
const { getWorkerIndex } = require('./workerInfo');

/**
 * Workers always send IPC heartbeats to the primary (fast, local).
 * Optional bus/redis broadcast uses its own (usually slower) cadence.
 *
 * Config:
 *   zapi.monitoring.worker = {
 *     broadcast: false,           // default: no bus chatter
 *     intervalMs: 60000,          // bus broadcast cadence if enabled
 *     ipcIntervalMs: 5000,        // NEW: fast IPC cadence (local to primary)
 *     detail: 'summary'|'full'
 *   }
 */
function createClusterHeartbeat({ bus, intervalMs = 5000, nodeId = os.hostname() }) {
    if (!bus) throw new Error('[ClusterHeartbeat] bus required');

    let ipcTimer = null;
    let offControl = null;

    async function start() {
        // Respond to control pings (unchanged)
        offControl = await bus.subscribe('sys:control', async (msg) => {
            try {
                if (msg?.cmd === 'ping') {
                    await bus.publish('sys:pong', { nodeId, pid: process.pid, ts: Date.now() });
                }
            } catch {}
        });

        const cfg  = getConfig?.() || {};
        const wCfg = cfg?.zapi?.monitoring?.worker || {};
        const busEnabled = !!wCfg.broadcast;
        const busMs  = Number(wCfg.intervalMs ?? 60000);
        const ipcMs  = Number(wCfg.ipcIntervalMs ?? intervalMs ?? 5000);
        const full   = (wCfg.detail === 'full');

        let lastBusAt = 0;

        const buildPayload = () => {
            const mem = process.memoryUsage();
            const base = {
                nodeId,
                pid: process.pid,
                workerIndex: getWorkerIndex(),
                ts: Date.now(),
                uptimeSec: Math.floor(process.uptime())
            };
            if (full) return { ...base, rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal };
            return { ...base, rss: mem.rss, heapUsed: mem.heapUsed };
        };

        const sendIpc = (payload) => {
            try {
                if (typeof process.send === 'function') {
                    process.send({ type: 'sys:heartbeat', payload });
                }
            } catch {}
        };

        const maybeBus = async (payload) => {
            if (!busEnabled) return;
            const now = Date.now();
            if (now - lastBusAt >= busMs) {
                lastBusAt = now;
                try { await bus.publish('sys:heartbeat', payload); } catch {}
            }
        };

        // --- Immediate IPC kick so leader has something before first snapshot ---
        const first = buildPayload();
        sendIpc(first);
        await maybeBus(first);

        // --- Fast IPC loop (independent of bus cadence) ---
        ipcTimer = setInterval(async () => {
            const p = buildPayload();
            sendIpc(p);
            await maybeBus(p);
        }, Math.max(250, ipcMs)); // tiny floor to avoid silly 0/negative values
    }

    async function stop() {
        if (ipcTimer) clearInterval(ipcTimer), (ipcTimer = null);
        try { offControl?.(); } catch {}
        offControl = null;
    }

    return { start, stop };
}

module.exports = { createClusterHeartbeat };
