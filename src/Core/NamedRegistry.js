'use strict';

class NamedRegistry {
    constructor(kind = 'item') {
        this.kind = kind;
        this._map = new Map();
    }
    set(name, value) {
        if (!name) throw new Error(`[${this.kind}] name is required`);
        this._map.set(name, value);
        return value;
    }
    get(name) {
        if (!this._map.has(name)) throw new Error(`[${this.kind}] not found: ${name}`);
        return this._map.get(name);
    }
    has(name) { return this._map.has(name); }
    delete(name) { return this._map.delete(name); }
    list() { return Array.from(this._map.keys()); }
    clear() { this._map.clear(); }
}

module.exports = { NamedRegistry };
