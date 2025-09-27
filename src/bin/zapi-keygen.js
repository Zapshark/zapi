#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');

function genHash(raw, { iterations = 310000, klen = 32, algo = 'sha256' } = {}) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(raw, salt, iterations, klen, algo);
    return `pbkdf2$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verify(raw, encoded) {
    try {
        const [scheme, iterStr, saltB64, hashB64] = String(encoded).split('$');
        if (scheme !== 'pbkdf2') throw new Error('Unsupported scheme');
        const iterations = Number(iterStr);
        const salt = Buffer.from(saltB64, 'base64');
        const target = Buffer.from(hashB64, 'base64');
        const probe  = crypto.pbkdf2Sync(raw, salt, iterations, target.length, 'sha256');
        return crypto.timingSafeEqual(target, probe);
    } catch { return false; }
}

function randomKey(len = 24) {
    return crypto.randomBytes(len).toString('base64url'); // easy to paste but strong
}

(async () => {
    const [cmd, a1, a2] = process.argv.slice(2);

    if (cmd === 'gen') {
        const raw = a1 || randomKey();
        const out = genHash(raw);
        console.log('RAW KEY (store securely, never commit):', raw);
        console.log('CONFIG VALUE (paste under zapi.apiBackend.apiKeyHash):', out);
        process.exit(0);
    }

    if (cmd === 'verify') {
        const ok = verify(a1, a2);
        console.log(ok ? 'OK: key matches hash' : 'FAIL: key does not match hash');
        process.exit(ok ? 0 : 2);
    }

    console.log(`Usage:
  zapi-keygen gen           # prints a random key + hash
  zapi-keygen gen <key>     # hash a provided key
  zapi-keygen verify <key> <hash>`);
})();
