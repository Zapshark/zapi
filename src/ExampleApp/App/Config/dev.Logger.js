'use strict';

module.exports = {
    Logger: {
        level: 'info',       // Log level
        timestamp: true,      // Include timestamps
        trace: true,           // Include trace file, line, and column
        logToFile: true,
        logLatestToFile: true,
        logDirectory: './logs',
        logFilename: 'app.log',
        logMaxSize: 1048576 // 1 MB
    }
};
