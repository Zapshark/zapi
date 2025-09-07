'use strict';
const { BaseService} = require('zapi');
const { getCacheKey, buildKey } = require('zapi');

class MyDataService extends BaseService {
    constructor({ framework, repo, name = 'MyDataService' } = {}) {
        super({ framework, name });

        // Grab your repo (however you already register it)
        this.repo = repo;
        if (!this.repo) {
            // If your project instantiates repos on-demand instead of via registry,
            // you can require and `new` it here instead:
            // const MyDemoRepository = require('../Repositories/MyDemoRepository');
            // this.repo = new MyDemoRepository({ framework });
            throw new Error('[MyDataService] MyDemoRepository not found in registry');
        }

        this.cache = framework.cache; // RedisCache instance (safe no-op if disabled)
        this.framework = framework;
    }

    // ---------- helpers ----------
    _def(name) {
        return getCacheKey(this.framework, name) || {}; // { ttl, prefix, notes }
    }
    _key(name, suffix = '') {
        return buildKey({ framework: this.framework, name, suffix });
    }

    // ---------- reads (cache-aside) ----------

    async listAll() {
        const keyName = 'MyDemo:list';
        const def = this._def(keyName);             // e.g., { ttl: 30 }
        const key = this._key(keyName);             // e.g., app:MyDemo:list

        return this.cache.cacheAside({ key, ttl: def.ttl }, async () => {
            // Your real DB call via the repo:
            return await this.repo.find({}, null, { sort: { createdAt: -1 } }, true);
        });
    }

    async getById(id) {
        const keyName = 'MyDemo:item';
        const def = this._def(keyName);
        const key = this._key(keyName, String(id)); // e.g., app:MyDemo:item:42

        return this.cache.cacheAside({ key, ttl: def.ttl }, async () => {
            return await this.repo.getById(id, { lean: true });
        });
    }

    // ---------- writes (invalidate / refresh cache) ----------

    async create(payload) {
        const doc = await this.repo.createDoc(payload);

        // nuke list cache so next listAll() repopulates
        try { await this.cache.del(this._key('MyDemo:list')); } catch {}

        // also set item cache (handy if caller reads it right away)
        try {
            const def = this._def('MyDemo:item');
            await this.cache.set(this._key('MyDemo:item', String(doc._id)), doc, def.ttl);
        } catch {}

        return doc;
    }

    async update(id, patch) {
        const updated = await this.repo.update(id, patch);

        // refresh item + bust list
        try {
            const def = this._def('MyDemo:item');
            await this.cache.set(this._key('MyDemo:item', String(id)), updated, def.ttl);
            await this.cache.del(this._key('MyDemo:list'));
        } catch {}

        return updated;
    }

    async remove(id) {
        const ok = await this.repo.remove(id);

        // drop item + list (if it existed)
        try {
            await this.cache.del(this._key('MyDemo:item', String(id)));
            await this.cache.del(this._key('MyDemo:list'));
        } catch {}

        return ok;
    }
}

module.exports = MyDataService;
