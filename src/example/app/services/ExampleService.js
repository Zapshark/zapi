'use strict';

const { BaseLifecycle, useModel } = require('@zapshark/zapi');

class ExampleService extends BaseLifecycle {
    static artifactName = 'ExampleService';
    static artifactKind = 'service';

    constructor({ cache, config } = {}) {
        super({ name: ExampleService.artifactName, kind: ExampleService.artifactKind });
        this.cache = cache;
        this.config = config;
    }

    async list({ includeDone = true } = {}) {
        const key = `example:todos:list:${includeDone ? 'all' : 'open'}`;
        if (this.cache) {
            const cached = await this.cache.get(key);
            this.log.debug("Cache key", key, "hit?", !!cached);
            this.log.debug("Cached key", cached);
            if (cached) return cached;
        }

        const Todo = useModel('Todo');
        const query = includeDone ? {} : { done: false };
        const items = await Todo.find(query).sort({ createdAt: -1 }).lean();

        if (this.cache) await this.cache.set(key, items, 60);
        return items;
    }

    async create({ title }) {
        if (!title) throw new Error('title required');

        const Todo = useModel('Todo');
        const doc = await Todo.create({ title, done: false });

        this.log.debug('Created todo', doc.id);
        this.log.debug('Invalidating cache key prefix', 'example:todos:list:');

        if (this.cache) await this.cache.delPath('example:todos:list:');
        return doc.toJSON();
    }

    async toggle(id) {
        if (!id) throw new Error('id required');

        const Todo = useModel('Todo');
        const todo = await Todo.findById(id).lean();
        this.log.debug('Toggling todo', id, 'found?', !!todo);
        this.log.debug('Todo', todo);

        if (!todo) throw new Error('todo not found');

        const updated = await Todo.findByIdAndUpdate(id, { done: !todo.done }, { new: true }).lean();
        this.log.debug('Updated todo', updated);
        this.log.debug('Invalidating cache key prefix', 'example:todos:list:');
        if (this.cache) await this.cache.delPath('example:todos:list:');
        return updated;
    }
}

module.exports = ExampleService;
