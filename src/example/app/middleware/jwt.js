module.exports = ({ config }) => async function jwt(req, res, next) {
    // verify your token here using config.jwtSecret, etc.
    next();
};
