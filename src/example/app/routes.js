'use strict';

const { resolveController, describeRoutes } = require('@zapshark/zapi');

module.exports = () => {
    const Example = resolveController('ExampleController');
    const Notes   = resolveController('NoteController');
    const Notifications = resolveController('NotificationController');
    const Group = resolveController('GroupController');

    return [
        // health
        { path: '/health',           method: 'get',    handler: async () => ({ ok: true }) },

        // Example (Todo) routes
        { path: '/todos',            method: 'get',    handler: Example.list, description: 'List All Todos' },
        { path: '/todos',            method: 'post',   handler: Example.create , description: 'Create Todo', middleware: ['auth'] },
        { path: '/todos/:id/toggle', method: 'post',   handler: Example.toggle , description: 'Toggle Todo', middleware: ['auth']},

        // Notes routes
        { path: '/notes',            method: 'get',    handler: Notes.list, description: 'List All Notes' },
        { path: '/notes',            method: 'post',   handler: Notes.create, description: 'Create Note', middleware: ['auth'] },
        { path: '/notes/:id/toggle', method: 'post',   handler: Notes.toggle, description: 'Toggle Note', middleware: ['auth'] },
        { path: '/_routes',          method: 'get',    handler: describeRoutes(), description: 'List All Routes' },

        // GroupService demo
        { path: '/groups',                    method: 'post',   handler: Group.create,      description: 'Create group + WS room', middleware: ['auth'] },
        { path: '/groups/:id',                method: 'get',    handler: Group.info,        description: 'Get group info' },
        { path: '/groups/:id/members/:userId',method: 'post',   handler: Group.addMember,   description: 'Add member', middleware: ['auth'] },
        { path: '/groups/:id/members/:userId',method: 'delete', handler: Group.removeMember,description: 'Remove member', middleware: ['auth'] },
        { path: '/groups/:id/message',        method: 'post',   handler: Group.sendMessage, description: 'Publish chat message', middleware: ['auth'] },
        { path: '/groups/:id/hook',           method: 'post',   handler: Group.addLogHook,  description: 'Add server-side hook', middleware: ['auth'] },
        { path: '/groups/:id',                method: 'delete', handler: Group.destroy,     description: 'Delete group + room', middleware: ['auth'] },

        // Notification demo (requires WS client to connect and authenticate)
        { path: '/notify/:userId',         method: 'post',   handler: Notifications.notify,    description: 'Notify a user room', middleware: ['auth'] },
        { path: '/notify/:userId/hook',    method: 'post',   handler: Notifications.addHook,   description: 'Add server-side hook for a user room', middleware: ['auth'] },
        { path: '/notify/:userId',         method: 'delete', handler: Notifications.removeUser,description: 'Remove user room + hooks', middleware: ['auth'] },

    // inside module.exports = () => { ... return [ ...existingRoutes, ...newOnes ]; };


        {
            path: '/notify/:userId',
            method: 'post'
        , middleware: ['auth'],
            description: 'Send message to user room',
            handler: async (req) => {
                const { userId } = req.params;
                const { message } = req.body || {};
                if (!userId || !message) throw new Error('userId and message required');

                const bus = resolveService('BusService');
                await bus.publish(`room:user:u_${userId}`, {
                    userId,
                    message,
                    ts: Date.now()
                });

                return { ok: true };
            }
        },

        // --- Chat group room test ---
        {
            path: '/chat/:roomId',
            method: 'post', middleware: ['auth'],
            description: 'Publish a chat message to a group room',
            handler: async (req) => {
                const { roomId } = req.params;
                const { user, text } = req.body || {};
                if (!roomId || !user || !text) throw new Error('roomId, user, text required');

                const bus = resolveService('BusService');
                await bus.publish(`room:chat:${roomId}`, { roomId, user, text, ts: Date.now() });
                return { ok: true };
            }
        },




];
};
