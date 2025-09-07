'use strict';
// minimal in-memory model with CRUD surface
let _id = 0;
const rows = new Map();

module.exports = {
    async create(data){ const id=String(++_id); const doc={ id, title:data.title??'', done:!!data.done }; rows.set(id,doc); return doc; },
    async findById(id){ return rows.get(String(id))||null; },
    async find(filter={}){ const list=[...rows.values()]; if(!Object.keys(filter).length) return list;
        return list.filter(d => Object.entries(filter).every(([k,v]) => d[k]===v)); },
    async update(id,data){ const doc=rows.get(String(id)); if(!doc) return null; Object.assign(doc,data); return doc; },
    async remove(id){ return rows.delete(String(id)); }
};
