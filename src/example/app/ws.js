// src/example/app/ws.js
// Dynamically subscribe to bus channels as clients join rooms.
// Room name conventions: "user:<id>", "group:<id>", "notify:<id>", etc.
// Bus channel = "room:<roomName>" (MessageBus will add "ws:" prefix internally if configured).

module.exports = async function initWS({ bus, wss, broadcast }) {
    // room -> { refCount: number, off: Function }
    const roomRefs = new Map();

    async function ensureSubscribed(room) {
        let r = roomRefs.get(room);
        if (r) return r;

        // Subscribe once per worker to bus channel for this room
        const off = await bus.subscribe(`room:${room}`, (payload) => {
            // fan out only to clients that joined this room
            broadcast(payload, (client) => client?.meta?.rooms?.has(room));
        });

        r = { refCount: 0, off };
        roomRefs.set(room, r);
        return r;
    }

    function releaseRoom(room) {
        const r = roomRefs.get(room);
        if (!r) return;
        if (r.refCount <= 0) {
            try { r.off?.(); } catch {}
            roomRefs.delete(room);
        }
    }

    wss.on('connection', (ws, req) => {
        ws.meta = { ip: req.socket.remoteAddress, rooms: new Set() };

        ws.on('message', async (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            // Protocol: { type: 'join'|'leave'|'publish', room, data? }
            const { type, room, data } = msg || {};
            if (!type) return;

            if (type === 'join' && room) {
                const sub = await ensureSubscribed(room);
                sub.refCount++;
                ws.meta.rooms.add(room);
                ws.send(JSON.stringify({ joined: room }));
            }

            else if (type === 'leave' && room) {
                if (ws.meta.rooms.delete(room)) {
                    const r = roomRefs.get(room);
                    if (r) { r.refCount--; releaseRoom(room); }
                }
                ws.send(JSON.stringify({ left: room }));
            }

            else if (type === 'publish' && room) {
                // Publish to the bus so all workers get it
                await bus.publish(`room:${room}`, { room, data, from: ws.meta.ip, ts: Date.now() });
            }
        });

        ws.on('close', () => {
            // decrement refCounts for any rooms this socket had joined
            for (const room of ws.meta.rooms) {
                const r = roomRefs.get(room);
                if (r) { r.refCount--; releaseRoom(room); }
            }
            ws.meta.rooms.clear();
        });
    });

    return { dispose: async () => {
            // best-effort clean up (not strictly required—worker shutdown handles it)
            for (const { off } of roomRefs.values()) { try { off(); } catch {} }
            roomRefs.clear();
        }};
};
