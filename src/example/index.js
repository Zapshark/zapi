'use strict';
const { bootstrap } = require('@zapshark/zapi');

bootstrap().catch(err => { console.error(err); process.exit(1); });
