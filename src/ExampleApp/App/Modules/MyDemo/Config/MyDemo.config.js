'use strict';
/**
 * CacheKeys configuration for MyDemo.
 */
module.exports = {
    CacheKeys: [
        { name: 'MyDemo:list', ttl: 30, prefix: 'app', notes: 'List of all demo docs' },
        { name: 'MyDemo:item', ttl: 300, prefix: 'app', notes: 'Single doc by id' },
    ],
};
