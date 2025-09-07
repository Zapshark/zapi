'use strict';
const BaseRepository = require('zapi').BaseRepository;
const TodoModel = require('../Models/Todo');

class TodoRepository extends BaseRepository {
    constructor({ framework }) {
        super({ framework, name: 'TodoRepository', model: TodoModel });
    }
}
module.exports = TodoRepository;
