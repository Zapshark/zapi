'use strict';
const { BaseRepository } = require('zapi');
const AuditEvent = require('../Models/AuditEvent');

class AuditRepository extends BaseRepository {
    constructor({ framework }) {
        super({ framework, name: 'AuditRepository', model: AuditEvent });
    }

    // Example of a repo-specific helper
    listRecent(limit = 50) {
        return this.find({}, { desc: true, limit });
    }
}

module.exports = AuditRepository;
