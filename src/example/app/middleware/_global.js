// app/middleware/_global.js

module.exports = ({ config, resolveService, resolveController }) => ({
    // Runs before every route
    pre: [
        'shapeResponse', // must run BEFORE routes so it can wrap res.json
        'cors',                         // a named middleware from app/middleware/cors.js
        (req, _res, next) => {          // inline example
            req._start = Date.now();
            next();
        }                       // e.g., enforce auth globally
    ],

    // Runs after every route (even if the route already res.json’d)
    post: [
        (req, res, next) => {
            // Example: attach a timing header


            next();
        },
        // You can also put a named post-processor here if you want standardized response shapes
        // 'shapeResponse'
    ]
});
