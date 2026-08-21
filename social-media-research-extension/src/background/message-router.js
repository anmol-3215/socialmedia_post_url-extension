/**
 * message-router.js — Routes messages between dashboard, service worker, and content scripts.
 *
 * All communication flows through this module so there is a single place to
 * inspect, log, and handle every message type.
 */

import { MSG } from "../shared/constants.js";
import { createLogger } from "../shared/logger.js";
import {
  startExtraction,
  stopExtraction,
  pauseExtraction,
  resumeExtraction,
  processResultBatch,
  handleContentStatus,
  clearAllResults,
} from "./extraction-manager.js";
import { loadSettings, saveSettings } from "../storage/storage-manager.js";
import { getResults } from "../storage/indexed-db.js";
import { exportResultsCsv } from "../export/csv-exporter.js";
import { exportResultsXlsx } from "../export/xlsx-exporter.js";
import { exportResultsJson } from "../export/json-exporter.js";

const logger = createLogger("message-router");

/**
 * Initialize the message router.
 * Call this once from the service worker.
 */
export function initMessageRouter() {
  chrome.runtime.onMessage.addListener(handleMessage);
  logger.info("Message router initialized");
}

/**
 * Central message handler.
 * @param {object} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {function} sendResponse
 * @returns {boolean} True if response will be sent asynchronously.
 */
function handleMessage(message, sender, sendResponse) {
  if (!message || !message.type) {
    logger.debug("Received message without type — ignoring");
    return false;
  }

  const { type, payload } = message;
  const source = sender.tab ? `tab:${sender.tab.id}` : "dashboard";

  logger.debug(`Message received: ${type} from ${source}`);

  switch (type) {

    // ─── Dashboard → Service Worker ──────────────────────────────────

    case MSG.START_EXTRACTION:
      handleAsync(async () => {
        await startExtraction(payload);
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.STOP_EXTRACTION:
      handleAsync(async () => {
        await stopExtraction();
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.PAUSE_EXTRACTION:
      handleAsync(async () => {
        await pauseExtraction();
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.RESUME_EXTRACTION:
      handleAsync(async () => {
        await resumeExtraction();
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.GET_SETTINGS:
      handleAsync(async () => {
        const settings = await loadSettings();
        sendResponse({ ok: true, settings });
      }, sendResponse);
      return true;

    case MSG.SAVE_SETTINGS:
      handleAsync(async () => {
        await saveSettings(payload.settings);
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.GET_RESULTS:
      handleAsync(async () => {
        const results = await getResults();
        sendResponse({ ok: true, results });
      }, sendResponse);
      return true;

    case MSG.CLEAR_RESULTS:
      handleAsync(async () => {
        await clearAllResults();
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.EXPORT_CSV:
      handleAsync(async () => {
        await exportResultsCsv();
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.EXPORT_XLSX:
      handleAsync(async () => {
        await exportResultsXlsx();
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.EXPORT_JSON:
      handleAsync(async () => {
        await exportResultsJson();
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    // ─── Content Script → Service Worker ─────────────────────────────

    case MSG.CS_RESULTS:
      handleAsync(async () => {
        await processResultBatch(payload.results, sender.tab?.id);
        sendResponse({ ok: true });
      }, sendResponse);
      return true;

    case MSG.CS_STATUS:
      handleContentStatus(payload, sender.tab?.id);
      sendResponse({ ok: true });
      return false;

    case MSG.CS_ERROR:
      handleContentStatus({ status: "ERROR", message: payload.message }, sender.tab?.id);
      sendResponse({ ok: true });
      return false;

    // ─── Logging (content script / dashboard → service worker) ───────

    case MSG.LOG_ENTRY:
      // Forward to all dashboard instances
      broadcastToDashboard(message);
      return false;

    default:
      logger.debug(`Unhandled message type: ${type}`);
      return false;
  }
}

/**
 * Run an async handler and catch errors.
 * @param {function} fn
 * @param {function} sendResponse
 */
async function handleAsync(fn, sendResponse) {
  try {
    await fn();
  } catch (err) {
    logger.error(`Message handler error: ${err.message}`);
    try {
      sendResponse({ ok: false, error: err.message });
    } catch {
      // sendResponse may have already been called or the channel closed
    }
  }
}

/**
 * Broadcast a message to the dashboard (side panel).
 * Uses chrome.runtime.sendMessage which reaches all extension pages.
 *
 * @param {object} message - { type, payload }
 */
export function broadcastToDashboard(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // Dashboard may not be open — silently ignore
    });
  } catch {
    // Extension context not available
  }
}
