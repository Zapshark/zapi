module.exports = function cors(_ctx) {
    return function corsHandler(_req, res, next) {
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-headers', 'Content-Type, Authorization');
        res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        if (_req.method === 'OPTIONS') return res.status(204).end();
        next();
    };
};
