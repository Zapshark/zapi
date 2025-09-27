'use strict';
const crypto = require('node:crypto');

function parseHash(encoded) {
    const [scheme, iterStr, saltB64, hashB64] = String(encoded || '').split('$');
    if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return null;
    return {
        iterations: Number(iterStr),
        salt: Buffer.from(saltB64, 'base64'),
        hash: Buffer.from(hashB64, 'base64'),
    };
}

function verifyKey(raw, encoded) {
    const parsed = parseHash(encoded);
    if (!parsed) return false;
    const probe = crypto.pbkdf2Sync(raw, parsed.salt, parsed.iterations, parsed.hash.length, 'sha256');
    try { return crypto.timingSafeEqual(parsed.hash, probe); } catch { return false; }
}

function requireBackendKey(cfg) {
    const headerName = cfg?.zapi?.apiBackend?.headerName || 'x-zapi-backend-key';
    const encoded = cfg?.zapi?.apiBackend?.apiKeyHash || '';

    return (req, res, next) => {
        if (!encoded) {
            return res.status(503).json({ ok: false, error: { code: 'BACKEND_LOCKED', message: 'Backend key not configured' } });
        }
        const raw = req.headers?.[headerName] || req.headers?.[headerName.toLowerCase()];
        if (!raw || typeof raw !== 'string' || !verifyKey(raw, encoded)) {
            return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid backend key' } });
        }
        return next();
    };
}

module.exports = { requireBackendKey, verifyKey, parseHash };
