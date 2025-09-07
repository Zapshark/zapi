'use strict';
const BaseService = require('zapi').BaseService;

class TodoService extends BaseService {
    constructor({ framework, repo }) {
        super({ framework, name: 'TodoService' });
        this.repo = repo;
    }
    list(){ return this.repo.find(); }
    add(title){ if(!title?.trim()) throw new Error('Title required'); return this.repo.create({ title: title.trim(), done:false }); }
    async toggle(id){ const item=await this.repo.findById(id); if(!item) throw new Error('Not found'); return this.repo.update(id,{ done:!item.done }); }
    async remove(id){ const ok=await this.repo.remove(id); if(!ok) throw new Error('Not found'); return { ok:true }; }
}
module.exports = TodoService;
