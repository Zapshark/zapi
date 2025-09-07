'use strict';
const cluster = require('node:cluster');
const os = require('node:os');

/**
 * Launch N worker processes that each run createServer().
 * - Primary only forks; workers run the HTTP/WebSocket server.
 * - Respawns on crash by default.
 */
async function launchCluster({ createServer, workers, log = console, respawn = true } = {}) {
    if (!createServer) throw new Error('[Cluster] createServer function required');
    const cpuCount = os.cpus()?.length || 1;
    const n = Math.max(1, Math.min(Number(workers) || cpuCount, 64));

    if (cluster.isPrimary) {
        log.info?.(`[Cluster] primary ${process.pid} starting ${n} worker(s)`);
        for (let i = 0; i < n; i++) cluster.fork();

        cluster.on('exit', (worker, code, signal) => {
            log.warn?.(`[Cluster] worker ${worker.process.pid} died (code:${code} signal:${signal})`);
            if (respawn) {
                log.info?.('[Cluster] respawning new worker');
                cluster.fork();
            }
        });
        return { role: 'primary', pid: process.pid };
    }

    // Worker: run the server
    await createServer();
    log.info?.(`[Cluster] worker ready ${process.pid}`);
    return { role: 'worker', pid: process.pid };
}

module.exports = { launchCluster };
