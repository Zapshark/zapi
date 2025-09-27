module.exports = async function auth(req, res, next) {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' });
    next();
};
