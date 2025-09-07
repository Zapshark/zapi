// App/Middleware/auth.js
module.exports = (framework) => ({
    name: 'auth',
    description: 'JWT auth gate',
    stage: 'pre',
    auto: false,                 // not auto; attach per-route
    priority: 50,
    // you can close over framework/config/services here
    handler: (req, res, next) => {

        next();
    }
});
