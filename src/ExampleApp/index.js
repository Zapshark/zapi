'use strict';
const path = require('path');
const { AppStandalone ,AppCluster  } = require('zapi');

const appRoot = path.resolve(__dirname);

// Option A: single process
AppStandalone({ appRoot });

// Option B: cluster-aware (env + config)
//AppCluster({ appRoot });
