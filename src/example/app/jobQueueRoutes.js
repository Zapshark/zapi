module.exports = ({ resolveService }) => ([
    {
        name: 'Demo:Sleep',
        middleware: async (payload) => ({ ms: Math.max(0, Number(payload?.ms || 100)) }),
        execute:    async ({ ms }) => { await new Promise(r => setTimeout(r, ms)); return { ok: true, slep: ms }; }
    }
]);