'use strict';

/**
 * BaseArtifact
 * - Anything extending this and constructed with `{ framework }` will auto-register.
 * - Subclasses set `static kind = 'service'|'repository'|'module'|'model'|'controller'`.
 */
class BaseArtifact {
    static kind = 'artifact';

    constructor({ framework, name, ...rest }) {
        if (!framework) throw new Error(`[${this.constructor.name}] requires { framework }`);
        this.framework = framework;
        this.name = name || this.constructor.name;
        Object.assign(this, rest);
        framework.register(this.constructor.kind, this.name, this);
    }
}

module.exports = BaseArtifact;
