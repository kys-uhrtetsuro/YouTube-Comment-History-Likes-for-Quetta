// Logging utility for YouTube Comment Viewer extension
// Automatically captures and saves console errors to a log file

class ExtensionLogger {
  constructor(context) {
    this.logFilePath = 'extension_errors.log';
    this.context = context || this.detectContext();
    this.originalConsoleError = console.error;
    this.originalConsoleWarn = console.warn;
    this.originalConsoleLog = console.log;
    this.originalConsoleInfo = console.info;
    this.setupErrorCapture();
  }

  detectContext() {
    try {
      const href = (typeof location !== 'undefined' && location.href) ? location.href : 'unknown';
      if (href.startsWith('chrome-extension://')) return 'VIEWER';
      if (href.includes('myactivity.google.com')) return 'CONTENT';
      return 'PAGE';
    } catch (e) {
      return 'UNKNOWN';
    }
  }

  setupErrorCapture() {
    // Override console.error to capture errors
    console.error = (...args) => {
      // Call the original console.error
      this.originalConsoleError.apply(console, args);

      // Format the error message
      const timestamp = new Date().toISOString();
      const errorMessage = this.formatErrorMessage(args);

      // Save to log file (in a way that would work in extension context)
      this.saveLogEntry(`${timestamp} [${this.context}] [ERROR] ${errorMessage}`);
    };

    // Also override console.warn to capture warnings
    console.warn = (...args) => {
      this.originalConsoleWarn.apply(console, args);

      const timestamp = new Date().toISOString();
      const warningMessage = this.formatErrorMessage(args);

      this.saveLogEntry(`${timestamp} [${this.context}] [WARNING] ${warningMessage}`);
    };

    // Also override console.log to capture important info
    console.log = (...args) => {
      this.originalConsoleLog.apply(console, args);

      const timestamp = new Date().toISOString();
      const logMessage = this.formatErrorMessage(args);

      // Only log certain important messages to avoid too much noise
      if (args.some(arg =>
        typeof arg === 'string' &&
        (arg.includes('YT Comment Viewer') ||
         arg.includes('Background') ||
         arg.includes('Viewer') ||
         arg.includes('Comment')))
      ) {
        this.saveLogEntry(`${timestamp} [${this.context}] [LOG] ${logMessage}`);
      }
    };

    // Also override console.info
    console.info = (...args) => {
      this.originalConsoleInfo.apply(console, args);

      const timestamp = new Date().toISOString();
      const infoMessage = this.formatErrorMessage(args);

      this.saveLogEntry(`${timestamp} [${this.context}] [INFO] ${infoMessage}`);
    };

    // Also capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const timestamp = new Date().toISOString();
      const errorMessage = `Unhandled Promise Rejection: ${event.reason}`;
      this.saveLogEntry(`${timestamp} [${this.context}] [UNHANDLED_REJECTION] ${errorMessage}`);
    });

    // Capture regular errors
    window.addEventListener('error', (event) => {
      const timestamp = new Date().toISOString();
      const errorMessage = `Global Error: ${event.error ? event.error.toString() : event.message}`;
      this.saveLogEntry(`${timestamp} [${this.context}] [GLOBAL_ERROR] ${errorMessage}`);
    });
  }

  formatErrorMessage(args) {
    return args.map(arg => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}\nStack: ${arg.stack}`;
      } else if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2);
      } else {
        return String(arg);
      }
    }).join(' ');
  }

  async saveLogEntry(logMessage) {
    try {
      // In a Chrome extension, we can use chrome.storage to save logs
      const result = await chrome.storage.local.get(['extensionLogs']);
      let logs = result.extensionLogs || [];

      // Add new log entry
      logs.push(logMessage);

      // Keep only the last 3000 log entries to prevent storage overflow
      if (logs.length > 3000) {
        logs = logs.slice(-3000);
      }

      // Save back to storage
      await chrome.storage.local.set({ extensionLogs: logs });

      // Also attempt to save to a local in-page buffer (for debugging purposes)
      this.saveToFile(logMessage);
    } catch (error) {
      // If chrome.storage fails, at least log to console
      this.originalConsoleError('Failed to save log entry:', error);
    }
  }

  saveToFile(logMessage) {
    // Create a blob with the log message
    const blob = new Blob([logMessage + '\n'], { type: 'text/plain' });

    // In extension context, we can't directly write files to disk
    // But we can prepare for download or save in a way accessible to developers
    const reader = new FileReader();
    reader.onload = function(event) {
      const content = event.target.result;

      // Store the content in localStorage as a fallback
      let storedLogs = localStorage.getItem('extensionErrorLogs') || '';
      localStorage.setItem('extensionErrorLogs', storedLogs + content);
    };
    reader.readAsText(blob);
  }


  // Method to clear logs
  clearLogs() {
    chrome.storage.local.remove('extensionLogs');
    localStorage.removeItem('extensionErrorLogs');
  }

  // Method to get recent logs
  getRecentLogs(limit = 100) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['extensionLogs'], (result) => {
        const logs = result.extensionLogs || [];
        resolve(logs.slice(-limit));
      });
    });
  }

  // Method to get all logs
  getAllLogs() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['extensionLogs'], (result) => {
        const logs = result.extensionLogs || [];
        resolve(logs);
      });
    });
  }
}

// Initialize the logger when this script loads
const extensionLogger = new ExtensionLogger();

// Export for use in other modules if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExtensionLogger;
}
