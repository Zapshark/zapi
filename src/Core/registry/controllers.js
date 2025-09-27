'use strict';

const { NamedRegistry } = require('../NamedRegistry');
const reg = new NamedRegistry('controller');

function setController(name, instance) { return reg.set(name, instance); }
function resolveController(name) { return reg.get(name); }
function hasController(name) { return reg.has(name); }
function deleteController(name) { return reg.delete(name); }
function listControllers() { return reg.list(); }
function clearControllers() { return reg.clear(); }

module.exports = {
    setController, resolveController, hasController, deleteController, listControllers, clearControllers
};
