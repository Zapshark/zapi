/* --- FILE: src\Core\ModelLoader.js --- */
'use strict';

const fs = require('fs');
const path = require('path');

function _getMongoose() {
    try { return require('mongoose'); }
    catch (err) {
        const e = new Error('[ModelLoader] "mongoose" not found. Install: npm i mongoose');
        e.cause = err; throw e;
    }
}

function _isFile(p) { try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; } }
function _isDir(p)  { try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; } }

function _readDir(p, pattern) {
    if (!_isDir(p)) return [];
    return fs.readdirSync(p).filter(f => pattern.test(f)).map(f => path.join(p, f));
}

const ModelLoader = {
    /**
     * Scans <appRoot>/App/Models for *.model.js files.
     * If multiple Mongo connections exist (via config 'MongoDB.connections' with >1 keys),
     * expects subfolders named after connection keys (e.g., Models/default/*.model.js, Models/analytics/*.model.js).
     *
     * Each file must export either:
     *   - An object: { name, schema, collection? }
     *   - A factory: (ctx) => ({ name, schema, collection? })
     *     where ctx = { mongoose, Schema }
     *
     * The { schema } should be a mongoose.Schema. If it doesn’t specify { collection }, we’ll
     * pass it via the third argument to model() (from the 'collection' field you export).
     *
     * Registry:
     *   - Registers each schema at kind 'modelSchemas' with key `${connection}:${name}`
     *   - Also registers a best-effort alias at key `${name}` if not already taken (handy for single-connection apps)
     *
     * @returns {{count:number, multi:boolean, baseDir:string, byConnection:Record<string,number>}}
     */
    load({ framework, appRoot, log = console }) {
        if (!framework) throw new Error('[ModelLoader] requires { framework }');
        if (!appRoot) throw new Error('[ModelLoader] requires { appRoot }');

        const mongoose = _getMongoose();
        const ModelsDir = path.join(appRoot, 'App', 'Models');
        const Schema = mongoose.Schema;

        if (!_isDir(ModelsDir)) {
            log?.warn?.(`[ModelLoader] No Models directory at ${ModelsDir}`);
            return { count: 0, multi: false, baseDir: ModelsDir, byConnection: {} };
        }

        // Detect connections from config registry
        const mongoCfg = framework.resolve('config', 'MongoDB');
        const connections = (mongoCfg && mongoCfg.connections && typeof mongoCfg.connections === 'object')
            ? Object.keys(mongoCfg.connections)
            : ['default'];

        const multi = connections.length > 1;
        const zapiCfg = framework.resolve('config', 'Zapi') || {};
        const modelsCfg = zapiCfg.models || {};
// default behavior: alias in single-connection; do NOT alias in multi-connection
        const aliasWhenSingle = modelsCfg.aliasWhenSingle !== false; // default true
        const aliasWhenMulti  = modelsCfg.aliasWhenMulti === true;   // default false

        const byConnection = {};

        const fileGlob = /\.model\.js$/i;

        if (!multi) {
            // Single connection -> directly under App/Models/*.model.js
            const files = _readDir(ModelsDir, fileGlob);
            byConnection.default = 0;

            for (const abs of files) {
                const mod = require(abs);
                const def = (typeof mod === 'function') ? mod({ mongoose, Schema }) : mod;
                if (!def?.name || !def?.schema) { log?.warn?.(`[ModelLoader] Skipped: ${abs} (expects { name, schema })`); continue; }

                const entry = {
                    name: def.name,
                    schema: def.schema,
                    collection: def.collection,
                    database: def.database,
                    connection: 'default'
                };
                framework.register('modelSchemas', `default:${def.name}`, entry);
                if (aliasWhenSingle && !framework.has('modelSchemas', def.name)) {
                    framework.register('modelSchemas', def.name, entry);
                }

                byConnection.default++;
            }

            log?.info?.(`[ModelLoader] Loaded ${byConnection.default} model(s) from ${ModelsDir} (single connection)`);
            return { count: byConnection.default, multi, baseDir: ModelsDir, byConnection };
        }

        // Multi-connection -> Models/<connection>/*.model.js
        let total = 0;
        for (const conn of connections) {
            const dir = path.join(ModelsDir, conn);
            const files = _readDir(dir, fileGlob);
            byConnection[conn] = 0;

            for (const abs of files) {
                const mod = require(abs);
                const def = (typeof mod === 'function') ? mod({ mongoose, Schema }) : mod;
                if (!def?.name || !def?.schema) { log?.warn?.(`[ModelLoader] Skipped: ${abs} (expects { name, schema })`); continue; }

                const entry = {
                    name: def.name,
                    schema: def.schema,
                    collection: def.collection,
                    database: def.database,
                    connection: 'default'
                };
                framework.register('modelSchemas', `${conn}:${def.name}`, entry);

                // Only alias if unique across all connections so repos that don’t specify a connection can still find it
                if (aliasWhenMulti && !framework.has('modelSchemas', def.name)) {
                    framework.register('modelSchemas', def.name, entry);
                }


                byConnection[conn]++; total++;
            }
        }

        log?.info?.(`[ModelLoader] Loaded ${total} model(s) under ${ModelsDir} (multi-connection: ${connections.join(', ')})`);
        return { count: total, multi, baseDir: ModelsDir, byConnection };
    }
};

module.exports = ModelLoader;
