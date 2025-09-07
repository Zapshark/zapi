// ExampleApp/App/Modules/Todo/index.js
'use strict';
const { Router } = require('express');

module.exports = (framework) => {
    const router = Router();
    router.get('/', (_req, res) => res.json({ status: 'ok' }));
    return router;
};
