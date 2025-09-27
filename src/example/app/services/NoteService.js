'use strict';

const { BaseLifecycle, useModel } = require('@zapshark/zapi');

class NoteService extends BaseLifecycle {
    static artifactName = 'NoteService';
    static artifactKind = 'service';

    constructor({ cache, config } = {}) {
        super({ name: NoteService.artifactName, kind: NoteService.artifactKind });
        this.cache = cache;
        this.config = config;
    }

    async list({ tag, includeArchived = false } = {}) {
        const key = `notes:list:${tag || 'all'}:${includeArchived ? 'all' : 'active'}`;
        if (this.cache) {
            const cached = await this.cache.get(key);
            if (cached) return cached;
        }

        const Note = useModel('Note');
        const query = {};
        if (tag) query.tags = tag;
        if (!includeArchived) query.archived = false;

        const items = await Note.find(query).sort({ createdAt: -1 }).lean();
        if (this.cache) await this.cache.set(key, items, 60);
        return items;
    }

    async create({ title, body = '', tags = [] }) {
        const Note = useModel('Note');
        const doc = await Note.create({ title, body, tags });
        if (this.cache) await this.cache.delPath('notes:list:');
        return doc.toJSON();
    }

    async toggleArchived(id, archived) {
        const Note = useModel('Note');
        const doc = await Note.findByIdAndUpdate(id, { archived: !!archived }, { new: true }).lean();
        if (this.cache) await this.cache.delPath('notes:list:');
        return doc;
    }
}

module.exports = NoteService;
