'use strict';
const BaseModule = require('zapi').BaseModule;
const TodoRepository = require('./Repositories/TodoRepository');
const TodoService = require('./Services/TodoService');

class TodoModule extends BaseModule {
    constructor({ framework, name='Todo' }) { super({ framework, name }); }
    async init() {
        const repo = new TodoRepository({ framework: this.framework });
        this.service = new TodoService({ framework: this.framework, repo });
        // no manual register needed; BaseService already auto-registered
    }

}
module.exports = TodoModule;
