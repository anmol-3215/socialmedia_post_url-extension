/**
 * logger.js — Structured logging with level filtering.
 *
 * Works in all extension contexts (service worker, content script, dashboard).
 * The dashboard wires LOG_ENTRY messages into its log drawer so service-worker
 * and content-script logs are visible to the user.
 */

import { LOG_LEVELS, MSG } from "./constants.js";

/** @type {number} Current minimum log level. 0 = DEBUG, 1 = INFO (default). */
let _minLevel = LOG_LEVELS.INFO;

/** @type {Array<{level:string, message:string, source:string, timestamp:number}>} */
const _buffer = [];
const _maxBuffer = 500;

/**
 * Enable or disable debug logging.
 * @param {boolean} enabled
 */
export function setDebugMode(enabled) {
  _minLevel = enabled ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
}

/**
 * Get current log buffer (newest last).
 * @returns {Array}
 */
export function getLogBuffer() {
  return _buffer.slice();
}

/**
 * Clear the log buffer.
 */
export function clearLogBuffer() {
  _buffer.length = 0;
}

/**
 * Core log function.
 * @param {"DEBUG"|"INFO"|"WARN"|"ERROR"} level
 * @param {string} message
 * @param {string} [source="extension"]
 */
export function log(level, message, source = "extension") {
  const numLevel = LOG_LEVELS[level] ?? LOG_LEVELS.INFO;
  if (numLevel < _minLevel) return;

  const entry = {
    level,
    message,
    source,
    timestamp: Date.now(),
  };

  // Buffer locally
  _buffer.push(entry);
  if (_buffer.length > _maxBuffer) _buffer.shift();

  // Console output (development aid)
  const prefix = `[${new Date(entry.timestamp).toLocaleTimeString()}] [${level}] [${source}]`;
  switch (level) {
    case "ERROR":
      console.error(prefix, message);
      break;
    case "WARN":
      console.warn(prefix, message);
      break;
    case "DEBUG":
      console.debug(prefix, message);
      break;
    default:
      console.log(prefix, message);
  }

  // Forward to dashboard via runtime messaging if available (service worker / content script)
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: MSG.LOG_ENTRY,
        payload: entry,
      }).catch(() => {
        // Silently ignore — dashboard may not be open
      });
    }
  } catch {
    // Not in an extension context (e.g., unit tests) — ignore
  }
}

// Convenience shortcuts
export function debug(message, source) { log("DEBUG", message, source); }
export function info(message, source) { log("INFO", message, source); }
export function warn(message, source) { log("WARN", message, source); }
export function error(message, source) { log("ERROR", message, source); }

/**
 * Create a scoped logger that automatically tags the source.
 * @param {string} source - e.g. "service-worker", "youtube-adapter"
 * @returns {{ debug, info, warn, error, log }}
 */
export function createLogger(source) {
  return {
    debug: (msg) => debug(msg, source),
    info: (msg) => info(msg, source),
    warn: (msg) => warn(msg, source),
    error: (msg) => error(msg, source),
    log: (level, msg) => log(level, msg, source),
  };
}
