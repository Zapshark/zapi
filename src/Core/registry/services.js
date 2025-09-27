'use strict';

const { NamedRegistry } = require('../NamedRegistry');
const reg = new NamedRegistry('service');

function setService(name, instance) { return reg.set(name, instance); }
function resolveService(name) { return reg.get(name); }
function hasService(name) { return reg.has(name); }
function deleteService(name) { return reg.delete(name); }
function listServices() { return reg.list(); }
function clearServices() { return reg.clear(); }

module.exports = {
    setService, resolveService, hasService, deleteService, listServices, clearServices
};
