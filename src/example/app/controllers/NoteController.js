'use strict';

const { BaseLifecycle, resolveService } = require('@zapshark/zapi');
// ensure model registers (side-effect)
require('../models/Note');

class NoteController extends BaseLifecycle {
    static artifactName = 'NoteController';
    static artifactKind = 'controller';

    constructor() {
        super({ name: NoteController.artifactName, kind: NoteController.artifactKind });

        this.list   = this.list.bind(this);
        this.create = this.create.bind(this);
        this.toggle = this.toggle.bind(this);
    }

    get svc() { return resolveService('NoteService'); }

    async init()  { this.log.info('init'); }
    async start() { this.log.info('start'); }
    async stop()  { this.log.info('stop'); }

    async list(req, _res) {
        const { tag, includeArchived } = req.query || {};
        return this.svc.list({ tag, includeArchived: includeArchived === 'true' });
    }

    async create(req, _res) {
        const { title, body, tags } = req.body || {};
        if (!title) throw new Error('title required');
        return this.svc.create({ title, body, tags });
    }

    async toggle(req, _res) {
        const { id } = req.params || {};
        const { archived } = req.body || {};
        if (!id) throw new Error('id required');
        return this.svc.toggleArchived(id, archived);
    }
}

module.exports = NoteController;
