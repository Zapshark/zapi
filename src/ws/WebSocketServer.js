'use strict';

// Import Node.js HTTP server and ws WebSocketServer
const http = require('node:http');
const { WebSocketServer } = require('ws');

/**
 * Starts a WebSocket server on the specified port.
 * Returns an object containing:
 *   - server: the underlying HTTP server
 *   - wss: the WebSocketServer instance
 *   - broadcastJSON: utility to broadcast JSON messages to clients
 *   - close: async function to gracefully shut down the server
 *
 * Features:
 *   - Uses a native HTTP server (no HTTP routes) to avoid conflicts with Express
 *   - Implements heartbeat (ping/pong) to detect and clean up dead connections
 *   - Provides a broadcast utility for sending messages to all or filtered clients
 *
 * @param {Object} options
 * @param {number} options.port - Port to listen on
 * @param {number} [options.heartbeatMs=30000] - Heartbeat interval in ms
 * @param {Function} [options.onReady] - Optional callback after server starts
 * @returns {Promise<Object>} - { server, wss, broadcastJSON, close }
 */
async function startWebSocketServer({ port, heartbeatMs = 30000, onReady } = {}) {
    // Create a native HTTP server (no routes, just for WebSocket upgrade)
    const server = http.createServer();

    // Create the WebSocket server, binding it to the HTTP server
    const wss = new WebSocketServer({ server });

    // --- Heartbeat / Connection Liveness ---
    // Helper to mark a connection as alive when pong is received
    function heartbeat() { this.isAlive = true; }

    // On new connection, set isAlive and listen for pong events
    wss.on('connection', (ws) => {
        ws.isAlive = true;
        ws.on('pong', heartbeat);
    });

    // Periodically ping all clients; terminate if no pong received
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate(); // Dead connection
            ws.isAlive = false; // Will be set true if pong received
            try { ws.ping(); } catch {} // Send ping
        });
    }, heartbeatMs).unref(); // Prevents interval from keeping Node alive

    // --- Broadcast Utility ---
    /**
     * Broadcasts a JSON-encoded message to all connected clients.
     * Optionally filters clients using filterFn.
     * @param {Object} obj - Data to send
     * @param {Function} [filterFn] - Optional filter function (ws) => boolean
     */
    function broadcastJSON(obj, filterFn) {
        const data = JSON.stringify(obj);
        wss.clients.forEach((ws) => {
            if (ws.readyState === ws.OPEN && (!filterFn || filterFn(ws))) {
                try { ws.send(data); } catch {}
            }
        });
    }

    // --- Start Server ---
    // Wait for the HTTP server to start listening
    await new Promise((resolve) => server.listen(port, resolve));

    // Call onReady callback if provided
    if (typeof onReady === 'function') onReady({ server, wss, broadcastJSON });

    // --- Return API ---
    return {
        server, // HTTP server instance
        wss, // WebSocketServer instance
        broadcastJSON, // Broadcast utility
        /**
         * Gracefully shuts down the WebSocket and HTTP server.
         * - Clears heartbeat interval
         * - Closes all WebSocket connections
         * - Closes the HTTP server
         */
        close: async () => {
            try { clearInterval(interval); } catch {}
            const done = new Promise((res) => server.close(() => res()));
            try { wss.clients.forEach((ws) => ws.close()); } catch {}
            await done;
        }
    };
}

// Export the startWebSocketServer function
module.exports = { startWebSocketServer };
