// core/system/workerInfo.js
const cluster = require('node:cluster');

function getWorkerIndex() {
    if (process.env.WORKER_INDEX != null) return Number(process.env.WORKER_INDEX);
    if (cluster.isWorker && typeof cluster.worker?.id === 'number') {
        return cluster.worker.id - 1; // cluster ids are 1..N → 0..N-1
    }
    return 0; // single-process / primary path
}

function getWorkerRole() {
    return cluster.isPrimary ? 'primary' : 'worker';
}

module.exports = { getWorkerIndex, getWorkerRole };
