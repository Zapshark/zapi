#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { detectEnvFiles } = require('../core/Env');

function parseArgv(argv) {
    const out = { includeLocal: true, excludeLocalInTest: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--cwd' && argv[i+1]) { out.cwd = path.resolve(argv[++i]); }
        else if (a === '--paths' && argv[i+1]) {
            out.paths = argv[++i].split(',').map(p => path.resolve(out.cwd || process.cwd(), p.trim()));
        }
        else if (a === '--include-src') {
            out.includeSrc = true;
        }
        else if (a === '--no-local') { out.includeLocal = false; }
        else if (a === '--exclude-local-in-test') { out.excludeLocalInTest = true; }
        else if (a === '--env' && argv[i+1]) { out.nodeEnv = argv[++i]; }
    }
    return out;
}

const opts = parseArgv(process.argv);
const cwd = opts.cwd || process.cwd();

let searchPaths = opts.paths;
if (!searchPaths) {
    searchPaths = [cwd];
    if (opts.includeSrc !== false) searchPaths.push(path.join(cwd, 'src'));
}

const files = detectEnvFiles({
    searchPaths,
    nodeEnv: opts.nodeEnv || process.env.NODE_ENV,
    includeLocal: opts.includeLocal,
    excludeLocalInTest: opts.excludeLocalInTest
});

console.log(`ZAPI env scan (NODE_ENV=${opts.nodeEnv || process.env.NODE_ENV || 'undefined'})`);
console.log(`Search paths:`);
for (const p of searchPaths) console.log(`  - ${path.relative(cwd, p) || '.'}`);

if (!files.length) {
    console.log('No .env files detected.');
    process.exit(0);
}

console.log(`\nFound (load order low → high):`);
for (const f of files) {
    console.log(`  - ${path.relative(cwd, f)}`);
}
