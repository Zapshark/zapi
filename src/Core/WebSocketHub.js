'use strict';
const { WebSocketServer } = require('ws');
const crypto = require('node:crypto');

/**
 * WebSocketHub
 * - Attaches to an existing http.Server
 * - Heartbeats (ping/pong)
 * - Simple channel routing by "name" with DI
 */
class WebSocketHub {
    constructor({ server, path = '/ws', framework, log = console, heartbeatMs = 30000 }) {
        if (!server) throw new Error('[WebSocketHub] requires { server }');
        this.framework = framework;
        this.log = log;
        this.wss = new WebSocketServer({ server, path });
        this.heartbeatMs = heartbeatMs;

        this.wss.on('connection', (ws, req) => {
            ws.id = req.headers['sec-websocket-key'] || crypto.randomUUID();
            ws.isAlive = true;

            ws.on('pong', () => { ws.isAlive = true; });

            ws.on('message', async (raw) => {
                try {
                    const msg = parseWs(raw);
                    // expect { name: 'channel', ...payload }
                    const handler = this.framework.resolve('wsHandler', msg?.name);
                    if (!handler || typeof handler.onMessage !== 'function') return;
                    await handler.onMessage({ ws, req, framework: this.framework }, msg);
                } catch (e) {
                    this.log.warn?.(`[WS] message error: ${e.message}`);
                }
            });

            const handler = this.framework.resolve('wsHandler', 'default');
            if (handler?.onConnect) {
                try { handler.onConnect({ ws, req, framework: this.framework }); } catch (e) {}
            }
        });

        // heartbeat
        this._interval = setInterval(() => {
            for (const ws of this.wss.clients) {
                if (!ws.isAlive) { try { ws.terminate(); } catch {} ; continue; }
                ws.isAlive = false;
                try { ws.ping(); } catch {}
            }
        }, this.heartbeatMs).unref();

        this.log.info?.(`[WS] listening on ${path}`);
    }

    broadcast(name, payload) {
        const msg = JSON.stringify({ name, payload });
        for (const ws of this.wss.clients) {
            if (ws.readyState === 1) ws.send(msg);
        }
    }

    close() {
        clearInterval(this._interval);
        this.wss?.close();
    }
}

function parseWs(raw) {
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    if (typeof raw !== 'string') return {};
    try { return JSON.parse(raw); } catch { return { name: 'raw', payload: raw }; }
}

module.exports = WebSocketHub;
