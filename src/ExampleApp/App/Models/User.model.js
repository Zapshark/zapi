// App/Models/User.model.js
'use strict';

module.exports = ({ mongoose }) => {
    const { Schema } = mongoose;
    const schema = new Schema(
        {
            email: { type: String, required: true, index: true, lowercase: true, trim: true },
            displayName: String,
            status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true }
        },
        { timestamps: true, versionKey: false, collection: 'users' } // <- collection here OR pass via "collection" below
    );
    return { name: 'User', schema /*, collection: 'users'  (optional if set in schema options) */ };
};
