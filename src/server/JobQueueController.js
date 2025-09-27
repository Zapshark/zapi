'use strict';

// Import base lifecycle for controller management
const { BaseLifecycle } = require('../core/BaseLifecycle');
// Registry helpers for controller/service resolution
const { resolveService, setController } = require('../core/registry/controllers');

/**
 * JobQueueController
 * - Thin façade for interacting with JobQueueServer.
 * - Designed for use in routes, services, or API backends.
 * - Handles job enqueueing, listing, and stats retrieval.
 */
class JobQueueController extends BaseLifecycle {
    // Artifact metadata for registry/discovery
    static artifactName = 'JobQueueController';
    static artifactKind  = 'controller';

    /**
     * Constructs the controller and registers it in the global registry.
     */
    constructor() {
        super({ name: JobQueueController.artifactName, kind: JobQueueController.artifactKind });
        setController(JobQueueController.artifactName, this);
    }

    /**
     * Resolves the JobQueueServer service instance.
     * - Uses registry to find the service.
     * @returns {JobQueueServer|null}
     */
    _svc() {
        // Ensure JobQueueServer is loaded and resolved from registry
        return require('./JobQueueServer') &&
            require('../core/registry/services').resolveService('JobQueueServer');
    }

    /**
     * Enqueues a job with the given name and payload.
     * @param {string} name - Job name/type
     * @param {any} payload - Job data
     * @returns {Promise<any>} - Result from JobQueueServer
     * @throws {Error} If JobQueueServer is unavailable
     */
    async enqueue(name, payload) {
        const svc = this._svc();
        if (!svc) throw new Error('JobQueueServer not available');
        return svc.enqueue(name, payload);
    }

    /**
     * Lists all jobs currently in the queue.
     * @returns {Promise<Array>} - Array of job objects
     */
    async list() {
        const svc = this._svc();
        return svc ? svc.listJobs() : [];
    }

    /**
     * Retrieves job queue statistics.
     * @returns {Promise<Object>} - Stats object (totalJobs, perRoute, etc.)
     */
    async stats() {
        const svc = this._svc();
        // Return default stats if service is unavailable
        return svc ? svc.getStats() : {
            totalJobs: 0,
            perRoute: {},
            throttleEvents: 0,
            throttledMsTotal: 0
        };
    }
}

// Export the controller for use in the application
module.exports = JobQueueController;
