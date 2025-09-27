'use strict';

const { BaseLifecycle, resolveService } = require('@zapshark/zapi');
// Ensure the model registers on load (side-effect only)
require('../models/Todo');

class ExampleController extends BaseLifecycle {
    static artifactName = 'ExampleController';
    static artifactKind = 'controller';

    constructor() {
        super({ name: ExampleController.artifactName, kind: ExampleController.artifactKind });

        // bind handlers for Express
        this.list   = this.list.bind(this);
        this.create = this.create.bind(this);
        this.toggle = this.toggle.bind(this);
    }

    // decoupled: resolve service by name at call-time (or cache in init/start if you prefer)
    get svc() {
        return resolveService('ExampleService');
    }

    async init()  { this.log.info('init'); }
    async start() { this.log.info('start'); }
    async stop()  { this.log.info('stop'); }

    async list(req, _res) {
        const includeDone = (req.query?.includeDone ?? 'true') === 'true';
        return this.svc.list({ includeDone });
    }

    async create(req, _res) {
        const { title } = req.body || {};
        return this.svc.create({ title });
    }

    async toggle(req, _res) {
        const { id } = req.params || {};
        return this.svc.toggle(id);
    }
}

module.exports = ExampleController;
