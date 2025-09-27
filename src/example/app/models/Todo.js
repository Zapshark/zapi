'use strict';

const { Schema } = require('mongoose');
const { registerModel } = require('@zapshark/zapi');

const TodoSchema = new Schema(
    {
        title:   { type: String, required: true },
        done:    { type: Boolean, default: false }
    },
    { timestamps: true }
);

// Registers as "Todo"
registerModel('Todo', TodoSchema);
