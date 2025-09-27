'use strict';

const { BaseLifecycle, resolveService } = require('@zapshark/zapi');

class GroupController extends BaseLifecycle {
    static artifactName = 'GroupController';
    static artifactKind = 'controller';

    constructor() {
        super({ name: GroupController.artifactName, kind: GroupController.artifactKind });

        // bind handlers
        this.create        = this.create.bind(this);
        this.info          = this.info.bind(this);
        this.addMember     = this.addMember.bind(this);
        this.removeMember  = this.removeMember.bind(this);
        this.sendMessage   = this.sendMessage.bind(this);
        this.addLogHook    = this.addLogHook.bind(this);
        this.destroy       = this.destroy.bind(this);
    }

    get svc() { return resolveService('GroupService'); }

    // POST /groups
    async create(req, _res) {
        const { name, members } = req.body || {};
        return this.svc.createGroup({ name, members });
    }

    // GET /groups/:id
    async info(req, _res) {
        return this.svc.list(req.params.id);
    }

    // POST /groups/:id/members/:userId
    async addMember(req, _res) {
        const { id, userId } = req.params;
        return this.svc.addMember(id, userId);
    }

    // DELETE /groups/:id/members/:userId
    async removeMember(req, _res) {
        const { id, userId } = req.params;
        return this.svc.removeMember(id, userId);
    }

    // POST /groups/:id/message  { from, text }
    async sendMessage(req, _res) {
        const { id } = req.params;
        const { from, text } = req.body || {};
        return this.svc.sendMessage(id, { from, text });
    }

    // POST /groups/:id/hook   (demo server-side hook that logs all msgs)
    async addLogHook(req, _res) {
        const { id } = req.params;
        const off = await this.svc.onMessage(id, (evt) => {
            console.log(`[Group:${id}] message`, evt);
        });
        // You’d typically persist this “off” somewhere if you want to remove it later
        return { ok: true };
    }

    // DELETE /groups/:id
    async destroy(req, _res) {
        return this.svc.deleteGroup(req.params.id);
    }
}

module.exports = GroupController;
