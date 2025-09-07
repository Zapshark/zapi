// App/Middleware/cors.js
module.exports = {
    name: 'cors',
    description: 'Enable CORS for all routes',
    stage: 'pre',        // 'pre' | 'post' (default 'pre')
    auto: true,          // if true, applied automatically
    priority: 10,        // smaller runs earlier
    handler: require('cors')({ origin: true })
};
