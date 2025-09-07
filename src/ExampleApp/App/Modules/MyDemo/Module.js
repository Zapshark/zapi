/* --- FILE: src\ExampleApp\App\Modules\MyDemo\Module.js --- */
'use strict';
const { BaseModule } = require('zapi');
const MyDataRepository = require('./Repositories/MyDataRepository');
const MyDataService = require('./Services/MyDataService');
const { BaseMongoRepository } = require('zapi');

class MyDemoModule extends BaseModule {
    constructor({ framework, name = 'MyDemo' }) {
        super({ framework, name });
    }

    async init() {
        // Ensure Mongo connections are wired
        await BaseMongoRepository.configureFromFrameworkConnections({ framework: this.framework, logger: this.framework.log });

        // Compose repo + service
        this.repo = new MyDataRepository({ framework: this.framework, dbName: 'myapp'  });
        this.service = new MyDataService({ framework: this.framework, repo: this.repo });
    }
}

module.exports = MyDemoModule;
