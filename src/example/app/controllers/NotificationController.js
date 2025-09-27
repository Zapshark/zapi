'use strict';

const { BaseLifecycle, resolveService } = require('@zapshark/zapi');

class NotificationController extends BaseLifecycle {
    static artifactName = 'NotificationController';
    static artifactKind = 'controller';

    constructor() {
        super({ name: NotificationController.artifactName, kind: NotificationController.artifactKind });

        this.notify       = this.notify.bind(this);
        this.addHook      = this.addHook.bind(this);
        this.removeUser   = this.removeUser.bind(this);
    }

    get svc() { return resolveService('NotificationService'); }

    // POST /notify/:userId  { title?, message?, data? }
    async notify(req, _res) {
        const { userId } = req.params;
        const { title, message, data } = req.body || {};
        await this.svc.notify(userId, { title, message, data });
        return { delivered: true, room: this.svc.roomName(userId) };
    }

    // POST /notify/:userId/hook
    // Adds a simple server-side hook that logs each notification
    async addHook(req, _res) {
        const { userId } = req.params;
        const off = await this.svc.onNotification(userId, (evt) => {
            console.log(`[notify user:${userId}]`, evt);
        });
        // you might persist "off" if you want to remove *just this* hook later
        return { ok: true, room: this.svc.roomName(userId) };
    }

    // DELETE /notify/:userId
    async removeUser(req, _res) {
        const { userId } = req.params;
        return this.svc.removeUser(userId);
    }
}

module.exports = NotificationController;
