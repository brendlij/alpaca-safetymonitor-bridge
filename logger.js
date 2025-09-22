// logger.js - Centralized logging system
const fs = require("fs");
const path = require("path");

class Logger {
  constructor(options = {}) {
    this.logPath = options.logPath || "./logs/app.log";
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.logLevel = options.logLevel || "info";

    // Ensure log directory exists
    this.ensureLogDir();

    // In-memory log buffer for web UI (last 500 entries)
    this.logBuffer = [];
    this.maxBufferSize = 500;
  }

  ensureLogDir() {
    const logDir = path.dirname(this.logPath);
    try {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true, mode: 0o755 });
      }
    } catch (error) {
      console.error(
        `[LOGGER] Failed to create log directory: ${error.message}`
      );
    }
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
  }

  writeToFile(formattedMessage) {
    try {
      // Check file size and rotate if needed
      if (fs.existsSync(this.logPath)) {
        const stats = fs.statSync(this.logPath);
        if (stats.size > this.maxFileSize) {
          this.rotateLogFile();
        }
      }

      fs.appendFileSync(this.logPath, formattedMessage + "\n");
    } catch (error) {
      console.error(`[LOGGER] Failed to write to log file: ${error.message}`);
    }
  }

  rotateLogFile() {
    try {
      // Rotate existing log files
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${this.logPath}.${i}`;
        const newFile = `${this.logPath}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          if (i === this.maxFiles - 1) {
            fs.unlinkSync(oldFile); // Delete oldest
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      // Move current log to .1
      if (fs.existsSync(this.logPath)) {
        fs.renameSync(this.logPath, `${this.logPath}.1`);
      }
    } catch (error) {
      console.error(`[LOGGER] Failed to rotate log file: ${error.message}`);
    }
  }

  addToBuffer(level, message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      data,
    };

    this.logBuffer.push(entry);

    // Keep buffer size in check
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
  }

  log(level, message, data = null) {
    const formattedMessage = this.formatMessage(level, message, data);

    // Always write to console
    switch (level) {
      case "error":
        console.error(formattedMessage);
        break;
      case "warn":
        console.warn(formattedMessage);
        break;
      default:
        console.log(formattedMessage);
    }

    // Write to file
    this.writeToFile(formattedMessage);

    // Add to in-memory buffer for web UI
    this.addToBuffer(level, message, data);
  }

  info(message, data = null) {
    this.log("info", message, data);
  }

  warn(message, data = null) {
    this.log("warn", message, data);
  }

  error(message, data = null) {
    this.log("error", message, data);
  }

  debug(message, data = null) {
    if (this.logLevel === "debug") {
      this.log("debug", message, data);
    }
  }

  getRecentLogs(limit = 100) {
    return this.logBuffer.slice(-limit);
  }

  // Read logs from file (for initial load)
  async getLogsFromFile(lines = 100) {
    try {
      if (!fs.existsSync(this.logPath)) {
        return [];
      }

      const data = fs.readFileSync(this.logPath, "utf8");
      const logLines = data
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      // Parse recent log lines
      const recentLines = logLines.slice(-lines);
      const parsedLogs = [];

      for (const line of recentLines) {
        try {
          // Parse format: [timestamp] [LEVEL] message
          const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] (.+)$/);
          if (match) {
            parsedLogs.push({
              timestamp: match[1],
              level: match[2],
              message: match[3],
              data: null,
            });
          }
        } catch (e) {
          // Skip malformed lines
        }
      }

      return parsedLogs;
    } catch (error) {
      this.error("Failed to read logs from file", { error: error.message });
      return [];
    }
  }
}

// Create singleton instance
const logger = new Logger({
  logPath: process.env.LOG_PATH || "./logs/app.log",
  logLevel: process.env.LOG_LEVEL || "info",
});

module.exports = logger;
