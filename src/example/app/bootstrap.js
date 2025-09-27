'use strict';
const { resolveService } = require('@zapshark/zapi');
module.exports = async function bootstrap({ cache, config }) {
    // Services/controllers auto-register on construction via BaseLifecycle

    // Example (Todo) module

const AppMonitoringLogger = require('./services/AppMonitoringLogger');
    new AppMonitoringLogger({ cache, config });
    const ExampleService = require('./services/ExampleService');
    const ExampleController = require('./controllers/ExampleController');
    new ExampleService({ cache, config });
    new ExampleController();

    // Notes module (if you’re keeping it)
    const NoteService = require('./services/NoteService');
    const NoteController = require('./controllers/NoteController');
    new NoteService({ cache, config });
    new NoteController();

    const GroupService = require('./services/GroupService');
    const GroupController = require('./controllers/GroupController');
    new GroupService({ cache, config });
    new GroupController();

    const NotificationService = require('./services/NotificationService');
    const NotificationController = require('./controllers/NotificationController');

    new NotificationService({ cache, config });
    new NotificationController();


    // If you rely on lifecycle hooks, you can call them here (optional):
    // const { resolveController } = require('@zapshark/zapi');
    // await resolveController('ExampleController').init?.();
    // await resolveController('ExampleController').start?.();
    // await resolveController('NoteController').init?.();
    // await resolveController('NoteController').start?.();
};
