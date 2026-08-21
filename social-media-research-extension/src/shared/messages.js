/**
 * messages.js — Message factory and schema for extension messaging.
 *
 * Every message flowing between dashboard, service worker, and content scripts
 * uses this consistent schema: { type: string, payload: object }.
 */

import { MSG } from "./constants.js";

/**
 * Create a typed message envelope.
 * @param {string} type - One of the MSG.* constants.
 * @param {object} [payload={}] - Message payload.
 * @returns {{ type: string, payload: object }}
 */
export function createMessage(type, payload = {}) {
  return { type, payload };
}

// ─── Outbound: Dashboard → Service Worker ────────────────────────────────────

export function startExtraction(config) {
  return createMessage(MSG.START_EXTRACTION, config);
}

export function stopExtraction() {
  return createMessage(MSG.STOP_EXTRACTION);
}

export function pauseExtraction() {
  return createMessage(MSG.PAUSE_EXTRACTION);
}

export function resumeExtraction() {
  return createMessage(MSG.RESUME_EXTRACTION);
}

export function getSettings() {
  return createMessage(MSG.GET_SETTINGS);
}

export function saveSettings(settings) {
  return createMessage(MSG.SAVE_SETTINGS, { settings });
}

export function exportCsv() {
  return createMessage(MSG.EXPORT_CSV);
}

export function exportXlsx() {
  return createMessage(MSG.EXPORT_XLSX);
}

export function exportJson() {
  return createMessage(MSG.EXPORT_JSON);
}

export function getResults() {
  return createMessage(MSG.GET_RESULTS);
}

export function clearResults() {
  return createMessage(MSG.CLEAR_RESULTS);
}

// ─── Inbound: Service Worker → Dashboard ─────────────────────────────────────

export function extractionStarted(config) {
  return createMessage(MSG.EXTRACTION_STARTED, config);
}

export function platformStatusUpdate(platform, status, details = {}) {
  return createMessage(MSG.PLATFORM_STATUS_UPDATE, { platform, status, ...details });
}

export function resultBatch(results) {
  return createMessage(MSG.RESULT_BATCH, { results });
}

export function extractionProgress(stats) {
  return createMessage(MSG.EXTRACTION_PROGRESS, stats);
}

export function extractionCompleted(stats) {
  return createMessage(MSG.EXTRACTION_COMPLETED, stats);
}

export function extractionError(message, details = {}) {
  return createMessage(MSG.EXTRACTION_ERROR, { message, ...details });
}

// ─── Internal: Service Worker ↔ Content Script ───────────────────────────────

export function csInit(config) {
  return createMessage(MSG.CS_INIT, config);
}

export function csExtract() {
  return createMessage(MSG.CS_EXTRACT);
}

export function csResults(results, stats = {}) {
  return createMessage(MSG.CS_RESULTS, { results, ...stats });
}

export function csScroll() {
  return createMessage(MSG.CS_SCROLL);
}

export function csStop() {
  return createMessage(MSG.CS_STOP);
}

export function csStatus(status) {
  return createMessage(MSG.CS_STATUS, { status });
}

export function csError(message, details = {}) {
  return createMessage(MSG.CS_ERROR, { message, ...details });
}

// ─── Logging ─────────────────────────────────────────────────────────────────

export function logEntry(level, message, source = "unknown") {
  return createMessage(MSG.LOG_ENTRY, { level, message, source, timestamp: Date.now() });
}
