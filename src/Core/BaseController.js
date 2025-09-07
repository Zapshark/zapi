'use strict';
const { Router } = require('express');
const BaseArtifact = require('./BaseArtifact');

/**
 * BaseController
 * - Optional convenience if you want stateful controllers.
 * - Use when exporting controllers from Controllers/*.js instead of plain factories.
 */
class BaseController extends BaseArtifact {
    static kind = 'controller';

    constructor({ framework, name }) {
        super({ framework, name });
        this.router = Router();
    }

    /** override to register routes */
    routes() {}

    getRouter() {
        this.routes();
        return this.router;
    }
}

module.exports = BaseController;
