'use strict';

const mongoose = require('mongoose');
const Outage = require('../core/infra/OutageDeduper');
const Infra = require('../core/infra/InfraStatus');
const { resolveService } = require('../core/registry/services');

const models = new Map(); // name -> { real: mongoose.Model|null, safe: Proxy }

function backoff(attempt) { return Math.min(attempt * 10000, 60000); } // 10→60s

async function emit(kind, phase, payload) {
    try {
        const EventServer = resolveService('EventServer');
        await EventServer?.publish?.(`zapi:infra:${kind}:${phase}`, payload);
    } catch {}
}

/**
 * Start a background (non-blocking) connector with scaling retry.
 * App continues to boot even if DB is down.
 */
function startMongoConnector(cfg) {
    if (!cfg?.mongo?.uri) {
        Infra.set('mongoUp', false, { reason: 'not-configured' });
        return;
    }

    let attempt = 0;
    const key = 'mongo:primary';

    const tryOnce = async () => {
        try {
            await mongoose.connect(cfg.mongo.uri, { serverSelectionTimeoutMS: 5000, ...(cfg.mongo.options || {}) });
            if (Outage.up(key).emitted) await emit('mongodb', 'up', { ts: Date.now() });
            Infra.set('mongoUp', true);
            attempt = 0; // reset attempts after success
        } catch (err) {
            attempt++;
            const reason = err?.code || err?.message || 'unknown';
            if (Outage.down(key, { reason }).emitted) await emit('mongodb', 'down', { reason, ts: Date.now() });
            Infra.set('mongoUp', false, { reason });
            setTimeout(tryOnce, backoff(attempt)); // schedule next try; DO NOT block startup
        }
    };

    // kick off immediately, but do not await
    tryOnce();

    // also watch native connection signals to keep InfraStatus aligned
    mongoose.connection.on('connected', () => Infra.set('mongoUp', true));
    mongoose.connection.on('disconnected', () => Infra.set('mongoUp', false, { reason: 'disconnected' }));
    mongoose.connection.on('error', () => Infra.set('mongoUp', false, { reason: 'error' }));
}

/**
 * Returns a standby Proxy for a model: while Mongo is down, any common read ops
 * resolve to null/empty arrays (non-throwing); writes resolve to null.
 * When Mongo is up, it delegates to the real model transparently.
 */
function makeSafeModel(name, getReal) {
    const empty = Promise.resolve(null);
    const emptyArr = Promise.resolve([]);

    const handler = {
        get(_t, prop) {
            const real = getReal();
            const up = Infra.isMongoUp() && real;
            if (!up) {
                // Non-throwing placeholders for most-used statics
                if (prop === 'find') return () => emptyArr;
                if (prop === 'findOne' || prop === 'findById') return () => empty;
                if (prop === 'aggregate') return () => emptyArr;
                if (prop === 'count' || prop === 'countDocuments' || prop === 'estimatedDocumentCount') return () => Promise.resolve(0);
                if (prop === 'create' || prop === 'insertMany' || prop === 'updateOne' || prop === 'updateMany' || prop === 'replaceOne' || prop === 'deleteOne' || prop === 'deleteMany') return () => empty;
                if (prop === 'watch') return () => ({ on() {}, close() {} });
                // Constructor path (new Model()) → return a dummy that no-ops on save()
                if (prop === 'prototype') {
                    return new Proxy({}, {
                        get() { return () => empty; } // any instance method (e.g., save) → resolves null
                    });
                }
                // Fallback: no-op function
                return () => empty;
            }
            // Mongo is up → delegate to real
            return Reflect.get(real, prop);
        },
        construct(_t, args) {
            const real = getReal();
            if (Infra.isMongoUp() && real) return new real(...args);
            return new Proxy({}, { get() { return () => Promise.resolve(null); } });
        }
    };

    return new Proxy(function SafeModelCtor(){}, handler);
}

function registerModel(name, schema) {
    if (models.has(name)) return models.get(name).safe;
    let real = null;
    try { real = mongoose.model(name); } catch {}
    if (!real) real = mongoose.model(name, schema);
    const getReal = () => {
        try { return mongoose.model(name); } catch { return null; }
    };
    const safe = makeSafeModel(name, getReal);
    models.set(name, { real, safe });
    return safe; // IMPORTANT: callers get the safe proxy, not the raw model
}

function useModel(name) {
    const m = models.get(name);
    if (!m) throw new Error(`Model not registered: ${name}`);
    return m.safe; // always return the safe proxy
}

async function disconnectMongo() {
    try { await mongoose.disconnect(); } catch {}
}

module.exports = {
    startMongoConnector, disconnectMongo, registerModel, useModel
};
