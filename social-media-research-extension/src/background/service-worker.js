/**
 * service-worker.js — MV3 background service worker entry point.
 *
 * Responsibilities:
 *   1. Register side panel so the toolbar icon opens the dashboard.
 *   2. Initialize the message router (all runtime-message handling).
 *   3. Restore extraction state on service-worker restart.
 *
 * This file must stay small — heavy logic lives in extraction-manager,
 * state-manager, and message-router.
 */

import { initMessageRouter } from "./message-router.js";
import { stateMachine } from "./state-manager.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("service-worker");

// ─── Side Panel ──────────────────────────────────────────────────────────────
// Clicking the toolbar icon opens the side panel (instead of a popup).

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => logger.debug("Side panel behavior registered"))
  .catch((err) => logger.error(`Failed to set side panel behavior: ${err.message}`));

// ─── Message Router ──────────────────────────────────────────────────────────

initMessageRouter();

// ─── State Restoration ───────────────────────────────────────────────────────
// If the service worker was killed mid-extraction (MV3 can do this after ~5 min
// of inactivity), restore the state machine from chrome.storage.local so the
// dashboard can show the last-known status.

stateMachine.restore()
  .then(() => logger.info("Service worker initialized — state restored"))
  .catch((err) => logger.error(`State restoration failed: ${err.message}`));

// ─── Lifecycle Logging ───────────────────────────────────────────────────────

self.addEventListener("install", () => {
  logger.info("Service worker installed");
});

self.addEventListener("activate", () => {
  logger.info("Service worker activated");
});
