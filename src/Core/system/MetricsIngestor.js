'use strict';

function createMetricsIngestor({ bus, flushMs = 10000 }) {
    if (!bus) throw new Error('[MetricsIngestor] bus required');

    let off = null;
    let timer = null;
    const counters = new Map(); // key -> number

    function inc(key, n = 1) {
        counters.set(key, (counters.get(key) || 0) + n);
    }

    async function start() {
        // Ingest raw metrics
        off = await bus.subscribe('sys:metrics', (evt) => {
            // Expect evt like { key:"api.requests", n:1 } or { batch: {key:count, ...} }
            if (!evt) return;
            if (evt.key) inc(evt.key, Number(evt.n || 1));
            if (evt.batch && typeof evt.batch === 'object') {
                for (const [k, v] of Object.entries(evt.batch)) inc(k, Number(v || 0));
            }
        });

        // Periodic flush/log
        timer = setInterval(async () => {
            if (counters.size === 0) return;

            const snapshot = Object.fromEntries(counters.entries());
            counters.clear();

            // Log locally (framework log system could be used here)
            try { console.log('[MetricsIngestor] flush', snapshot); } catch {}

            // Publish a summary others can react to (alerts, dashboards, etc.)
            try {
                await bus.publish('sys:metrics:flush', {
                    ts: Date.now(),
                    snapshot
                });
            } catch {}
        }, flushMs);
    }

    async function stop() {
        try { off?.(); } catch {}
        off = null;
        if (timer) clearInterval(timer), (timer = null);
    }

    return { start, stop };
}

module.exports = { createMetricsIngestor };
