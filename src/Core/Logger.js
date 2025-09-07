'use strict';

const fs = require('fs');
const path = require('path');

class Logger {
    constructor({
                    framework,
                    level = 'info',
                    timestamp = true,
                    trace = false,
                    jsonOutput = false,
                    transports = [console],
                    logToFile = false,
                    logLatestToFile = false,
                    logDirectory = './logs',
                    logFilename = 'app.log',
                    logMaxSize = 1048576 // 1 MB
                } = {}) {
        this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
        this.level = this.levels[level] ?? this.levels['info'];
        this.timestamp = timestamp;
        this.trace = trace;
        this.jsonOutput = jsonOutput;
        this.transports = transports;
        this.logToFile = logToFile;
        this.logLatestToFile = logLatestToFile;
        this.logDirectory = logDirectory;
        this.logFilename = logFilename;
        this.logMaxSize = logMaxSize;

        if (this.logToFile || this.logLatestToFile) {
            if (!fs.existsSync(this.logDirectory)) {
                fs.mkdirSync(this.logDirectory, { recursive: true });
            }
        }
    }

    configure(options = {}) {
        if (options.level && this.levels[options.level] !== undefined) {
            this.level = this.levels[options.level];
        }
        if (options.timestamp !== undefined) {
            this.timestamp = options.timestamp;
        }
        if (options.trace !== undefined) {
            this.trace = options.trace;
        }
        if (options.jsonOutput !== undefined) {
            this.jsonOutput = options.jsonOutput;
        }
        if (options.transports && Array.isArray(options.transports)) {
            this.transports = options.transports;
        }
        if (options.logToFile !== undefined) {
            this.logToFile = options.logToFile;
        }
        if (options.logLatestToFile !== undefined) {
            this.logLatestToFile = options.logLatestToFile;
        }
        if (options.logDirectory) {
            this.logDirectory = options.logDirectory;
            if (!fs.existsSync(this.logDirectory)) {
                fs.mkdirSync(this.logDirectory, { recursive: true });
            }
        }
        if (options.logFilename) {
            this.logFilename = options.logFilename;
        }
        if (options.logMaxSize !== undefined) {
            this.logMaxSize = options.logMaxSize;
        }
    }


    log(level, message, meta = {}) {
        if (this.levels[level] > this.level) return;

        const timestamp = this.timestamp ? new Date().toISOString() : undefined;
        const trace = this.trace ? this._getTrace() : undefined;
        const traceString = trace ? `${trace.file}:${trace.line}:${trace.column}` : undefined;

        const logEntry = { level, message, meta, timestamp, trace };

        const formattedLog = this.jsonOutput
            ? JSON.stringify(logEntry)
            : `${timestamp ? `[${timestamp}] ` : ''}${level.toUpperCase()}: ${message}${traceString ? ` (${traceString})` : ''}`;

        for (const transport of this.transports) {
            if (typeof transport[level] === 'function') {
                transport[level](formattedLog);
            } else if (typeof transport.log === 'function') {
                transport.log(formattedLog);
            }
        }

        if (this.logToFile) {
            this._writeToFile(formattedLog);
        }

        if (this.logLatestToFile) {
            this._writeLatestLog(formattedLog);
        }
    }


    _writeToFile(log) {
        const filePath = path.join(this.logDirectory, this.logFilename);
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > this.logMaxSize) {
            fs.renameSync(filePath, `${filePath}.${Date.now()}`);
        }
        fs.appendFileSync(filePath, log + '\n');
    }

    _writeLatestLog(log) {
        const latestFilePath = path.join(this.logDirectory, 'latest.log');
        if (!this._latestLogInitialized) {
            fs.writeFileSync(latestFilePath, ''); // Clear the file at the start of the session
            this._latestLogInitialized = true;
        }
        fs.appendFileSync(latestFilePath, log + '\n');
    }


    _getTrace() {
        const stack = new Error().stack.split('\n');
        for (let i = 2; i < stack.length; i++) {
            const match = stack[i].match(/\((.*):(\d+):(\d+)\)/);
            if (match) {
                const [, file, line, column] = match;
                if (!file.includes('Logger.js')) {
                    return { file, line, column };
                }
            }
        }
        return null;
    }

    error(message, meta) { this.log('error', message, meta); }
    warn(message, meta) { this.log('warn', message, meta); }
    info(message, meta) { this.log('info', message, meta); }
    debug(message, meta) { this.log('debug', message, meta); }
}

module.exports = Logger;
