'use strict';

module.exports = (framework) => ([
    {
        name: 'default',
        onConnect({ ws }) {
            ws.send(JSON.stringify({ name: 'welcome', payload: { id: ws.id } }));
        },
        onMessage({ ws }, msg) {
            // msg = { name, ...payload }
            if (msg.name === 'ping') {
                ws.send(JSON.stringify({ name: 'pong', t: Date.now() }));
            }
        }
    },
    {
        name: 'chat',
        onMessage({ ws, framework }, msg) {
            // broadcast to all clients on a channel
            const hub = framework.ws;
            hub?.broadcast('chat', { from: ws.id, text: msg.text });
        }
    }
]);
