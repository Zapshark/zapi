'use strict';

const { Schema } = require('mongoose');
const { registerModel } = require('@zapshark/zapi');

const NoteSchema = new Schema(
    {
        title:     { type: String, required: true },
        body:      { type: String, default: '' },
        tags:      [{ type: String }],
        archived:  { type: Boolean, default: false }
    },
    { timestamps: true }
);

registerModel('Note', NoteSchema); // registers as "Note"
