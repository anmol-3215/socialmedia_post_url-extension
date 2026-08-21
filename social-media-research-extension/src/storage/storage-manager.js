/**
 * storage-manager.js — Chrome storage.local wrapper for settings and state.
 *
 * Small key-value data (settings, extraction state) lives here.
 * Large result datasets use IndexedDB (see indexed-db.js).
 */

import { createLogger } from "../shared/logger.js";

const logger = createLogger("storage-manager");

// ─── Settings ────────────────────────────────────────────────────────────────

const SETTINGS_KEY = "smrt_settings";
const STATE_KEY = "smrt_extraction_state";

const DEFAULT_SETTINGS = Object.freeze({
  platform: "youtube",
  keyword: "",
  limit: "100",
  region: "india",
  demoMode: true,
  debugMode: false,
});

const DEFAULT_STATE = Object.freeze({
  status: "IDLE",
  discovered: 0,
  valid: 0,
  duplicates: 0,
  errors: 0,
  startedAt: null,
  platform: "",
  keywords: [],
  limit: 100,
  region: "",
});

/**
 * Load user settings from chrome.storage.local.
 * @returns {Promise<object>}
 */
export async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([SETTINGS_KEY]);
    const settings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
    logger.debug("Settings loaded");
    return settings;
  } catch (err) {
    logger.error(`Failed to load settings: ${err.message}`);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save user settings.
 * @param {object} settings
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  try {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
    logger.debug("Settings saved");
  } catch (err) {
    logger.error(`Failed to save settings: ${err.message}`);
  }
}

// ─── Extraction State ────────────────────────────────────────────────────────
// Persisted so state survives service-worker suspension/restart.

/**
 * Load the current extraction state.
 * @returns {Promise<object>}
 */
export async function getExtractionState() {
  try {
    const result = await chrome.storage.local.get([STATE_KEY]);
    return { ...DEFAULT_STATE, ...(result[STATE_KEY] || {}) };
  } catch (err) {
    logger.error(`Failed to load extraction state: ${err.message}`);
    return { ...DEFAULT_STATE };
  }
}

/**
 * Save extraction state.
 * @param {object} state
 * @returns {Promise<void>}
 */
export async function saveExtractionState(state) {
  try {
    await chrome.storage.local.set({ [STATE_KEY]: { ...DEFAULT_STATE, ...state } });
  } catch (err) {
    logger.error(`Failed to save extraction state: ${err.message}`);
  }
}

/**
 * Reset extraction state back to defaults.
 * @returns {Promise<void>}
 */
export async function resetExtractionState() {
  await saveExtractionState(DEFAULT_STATE);
}

// ─── Generic Helpers ─────────────────────────────────────────────────────────

/**
 * Get a value from chrome.storage.local with a fallback.
 * @param {string} key
 * @param {*} fallback
 * @returns {Promise<*>}
 */
export async function getStorageValue(key, fallback = null) {
  try {
    const result = await chrome.storage.local.get([key]);
    return result[key] ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Set a value in chrome.storage.local.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function setStorageValue(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    logger.error(`Failed to set storage key "${key}": ${err.message}`);
  }
}
