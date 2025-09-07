'use strict';

module.exports = {

    connections: {
        default: {
            uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/',
            user: process.env.MONGODB_DB_USER || 'root',
            pass: process.env.MONGODB_DB_PASS || 'password',
            dbName: process.env.MONGODB_DB_NAME || '',
            authenticate: process.env.MONGODB_AUTHENTICATE || false,
            options: {
                useNewUrlParser: true,
                useUnifiedTopology: true
            }
        }
    }
};
