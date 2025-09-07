'use strict';
const BaseArtifact = require('./BaseArtifact');

class BaseService extends BaseArtifact {
    static kind = 'service';
}

module.exports = BaseService;
