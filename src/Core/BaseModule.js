'use strict';
const BaseArtifact = require('./BaseArtifact');

class BaseModule extends BaseArtifact {
    static kind = 'module';
    async init() {}
    async start() {}
    async stop() {}
}

module.exports = BaseModule;
