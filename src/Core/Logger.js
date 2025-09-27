'use strict';

class Logger {
    constructor(name = 'zapi', level = 'info') {
        this.name = name;
        this.level = level;
        this._order = { debug: 10, info: 20, warn: 30, error: 40 };
    }
    _ok(l) { return this._order[l] >= this._order[this.level]; }
    debug(...a) { if (this._ok('debug')) console.log(`[${this.name}]`, ...a); }
    info (...a) { if (this._ok('info'))  console.log(`[${this.name}]`, ...a); }
    warn (...a) { if (this._ok('warn'))  console.warn(`[${this.name}]`, ...a); }
    error(...a) { if (this._ok('error')) console.error(`[${this.name}]`, ...a); }
}

module.exports = { Logger };
3612+6
