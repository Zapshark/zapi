module.exports = ({ mongoose }) => {
    const { Schema } = mongoose;
    const schema = new Schema(
        { title: String, description: String, tags: [String], createdAt: { type: Date, default: Date.now } },
        { versionKey: false }
    );

    return {
        name: 'MyData',
        schema,
        collection: 'mycollection',
        database: 'myapp'     // ⬅️ NEW: force this model to use the 'myapp' database
    };
};