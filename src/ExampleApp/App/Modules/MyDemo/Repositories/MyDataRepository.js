'use strict';
const { BaseMongoRepository } = require('zapi');

class MyDataRepository extends BaseMongoRepository {
    static dbName = 'myapp';
    constructor({ framework }) {
        super({ framework, name: 'MyDataRepository', connection: 'default' });
    }

    async getById(id) {
        return this.cacheCall({ name: 'MyDemo:item', suffix: String(id) }, async () => {
            return this.findById(id, { lean: true });
        });
    }

    async listAll() {
        return this.cacheCall({ name: 'MyDemo:list' }, async () => {
            return this.find({}, null, { sort: { createdAt: -1 } }, true);
        });
    }

    async createDoc(data) {
        if (typeof data !== 'object' || data === null) {
            throw new Error('[MyDataRepository] Invalid data: must be an object.');
        }

        const doc = await this.create(data);
        // Invalidate relevant caches
        try { await this.cache.del(this.buildCacheKey('MyDemo:list')); } catch {}
        return doc;
    }




}
module.exports = MyDataRepository;