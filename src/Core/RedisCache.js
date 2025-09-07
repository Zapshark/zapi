'use strict';
const IORedis = require('ioredis');
const { getCacheKey } = require('./CacheKeyRegistry'); // Import CacheKeyRegistry
const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), delay);
    };
};
class RedisCache {
    constructor(config, log = console) {
        this.servers = config.servers || [];
        this.suppressedRetryWarnings = false;
        if (this.servers.length === 0) {
            log?.warn?.('[Redis] No servers configured. Please check your Redis configuration.');
        }
        this.enabled = config.enabled !== false;
        this.log = log;
        this.client = null;
        this.prefix = ''; // Default prefix
        this.currentServerIndex = 0; // Track the current server
    }

    async connect() {
        if (!this.enabled || this._connecting) {
            this.log?.debug?.('[Redis] Skipping connect: already connecting or disabled.');
            return;
        }

        if (this.servers.length === 0) {
            this.log?.error?.('[Redis] No servers available for connection.');
            return;
        }

        this._connecting = true;
        let retryDelay = 10;
        const maxDelay = 60;
        const incrementBy = 10;

        const attemptConnection = async () => {
            const server = this.servers[this.currentServerIndex];
            if (!server) {
                this.log?.error?.('[Redis] No servers available for connection.');
                this.enabled = false;
                this._connecting = false;
                return;
            }

            this.prefix = server.prefix || ''; // Set the prefix for the current server
            if(!this.suppressedRetryWarnings) {
                this.log?.debug?.(`[Redis] Attempting to connect to ${server.host}:${server.port} with prefix "${this.prefix}"...`);
            }

            try {
                this.client = await this._createClient(server);
                this.enabled = true;
                this.suppressedRetryWarnings = false;
                this.log?.info?.(`[Redis] Connected to ${server.host}:${server.port}.`);
                this._connecting = false;
            } catch (e) {
                if(!this.suppressedRetryWarnings) {
                    this.log?.warn?.(`[Redis] Connection failed to ${server.host}:${server.port}: ${e.message}`);
                }
                this.enabled = false;

                if (retryDelay < maxDelay) {
                    this.log?.debug?.(`[Redis] Retrying connection in ${retryDelay} seconds...`);
                }else{
                    if (!this.suppressedRetryWarnings) {
                        this.log?.warn?.(`[Redis] Retry announcement limit reached. Further connection warnings/errors suppressed.`);
                        this.suppressedRetryWarnings = true;
                    }
                }

                setTimeout(() => {
                    this.currentServerIndex = (this.currentServerIndex + 1) % this.servers.length;
                    attemptConnection();
                }, retryDelay * 1000);

                retryDelay = Math.min(retryDelay + incrementBy, maxDelay);
            }
        };

        attemptConnection();
    }

    async _createClient(server) {
        const client = new IORedis({
            host: server.host,
            port: server.port,
            password: server.password,
            db: server.db,
            retryStrategy: () => null // Disable automatic retries
        });

        // Handle unhandled error events
        client.on('error', (err) => {
            if(!this.suppressedRetryWarnings) {
                this.log?.warn?.(`[Redis] Connection error: ${err.message}`);
            }

        });

        // Test the connection
        await client.ping(); // Throws an error if the server is unreachable
        return client;
    }








    async quit() {
        if (!this._up) return;
        try {
            await this.client.quit();
        } catch { /* ignore */ }
        this._up = false;
    }

    async get(key) {
        if (!this.client) throw new Error('[Redis] Client not connected.');
        const prefixedKey = `${this.prefix}:${key}`;
        try {
            const value = await this.client.get(prefixedKey);
            this.log?.debug?.(`[Redis] GET ${prefixedKey} -> ${value}`);
            return value;
        } catch (err) {
            this.log?.warn?.(`[Redis] GET ${prefixedKey} failed: ${err.message}`);
            return null;
        }
    }

    async set(key, value, ttl) {
        if (!this.client) throw new Error('[Redis] Client not connected.');
        const prefixedKey = `${this.prefix}:${key}`;
        try {
            if (ttl) {
                await this.client.set(prefixedKey, value, 'EX', ttl);
                this.log?.debug?.(`[Redis] SET ${prefixedKey} -> ${value} (TTL: ${ttl}s)`);
            } else {
                await this.client.set(prefixedKey, value);
                this.log?.debug?.(`[Redis] SET ${prefixedKey} -> ${value}`);
            }
        } catch (err) {
            this.log?.warn?.(`[Redis] SET ${prefixedKey} failed: ${err.message}`);
        }
    }


    async del(key) {
        if (!this.enabled) return 0;
        try { return await this.client.del(key); }
        catch (e) { this.log?.warn?.(`[Redis] del ${key} failed: ${e.message}`); return 0; }
    }

    /**
     * cacheAside — wrap an async producer, cache the result. No-op if disabled.
     * @param {object} params
     * @param {string} params.key     final cache key string
     * @param {number} [params.ttl]   ttl seconds (optional, will look up if omitted)
     * @param {Function} producer     async () => any
     */
    async cacheAside({ key, ttl }, producer) {
        if (!this.enabled) return producer();

        try {
            // Look up TTL from CacheKeyRegistry if not provided
            if (ttl == null && this.framework) {
                const cacheKey = getCacheKey(this.framework, key);
                ttl = cacheKey?.ttl;
            }

            const cachedValue = await this.get(key);
            if (cachedValue !== null) {
                this.log?.debug?.(`[Redis] cache hit: ${key}`);
                try {
                    return JSON.parse(cachedValue); // Deserialize if JSON
                } catch {
                    return cachedValue; // Return raw if not JSON
                }
            }

            const data = await producer();
            if (data !== undefined) {
                const valueToCache = typeof data === 'object' ? JSON.stringify(data) : data; // Serialize if object
                await this.set(key, valueToCache, ttl);
            }
            return data;
        } catch (err) {
            this.log?.warn?.(`[Redis] cacheAside error for key "${key}": ${err.message}`);
            return producer(); // Fallback to producer on error
        }
    }

}

module.exports = RedisCache;
