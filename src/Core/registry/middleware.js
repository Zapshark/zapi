'use strict';

const { NamedRegistry } = require('../NamedRegistry');
const reg = new NamedRegistry('middleware');

/**
 * Register an express-style middleware under a name.
 * @param {string} name
 * @param {(req,res,next)=>any} handler
 */
function setMiddleware(name, handler) {
    if (!name) throw new Error('[middleware] name is required');
    if (typeof handler !== 'function') throw new Error(`[middleware] "${name}" must be a function`);
    return reg.set(name, handler);
}

function resolveMiddleware(name) { return reg.get(name); }
function hasMiddleware(name) { return reg.has(name); }
function deleteMiddleware(name) { return reg.delete(name); }
function listMiddleware() { return reg.list(); }
function clearMiddleware() { return reg.clear(); }

module.exports = {
    setMiddleware, resolveMiddleware, hasMiddleware, deleteMiddleware, listMiddleware, clearMiddleware
};
