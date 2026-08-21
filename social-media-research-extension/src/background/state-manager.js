/**
 * state-manager.js — Extraction state machine & multi-worker tracker.
 *
 * Implements global state transitions:
 *   IDLE → INITIALIZING → SEARCHING → EXTRACTING → SCROLLING → PROCESSING → COMPLETED
 *
 * Also tracks per-platform worker states (READY, RUNNING, COMPLETED, RATE_LIMITED, ERROR, PAUSED)
 * and persists the state machine across service-worker suspension/restart.
 */

import { EXTRACTION_STATES, WORKER_STATUS } from "../shared/constants.js";
import { createLogger } from "../shared/logger.js";
import { saveExtractionState, getExtractionState } from "../storage/storage-manager.js";

const logger = createLogger("state-manager");

const VALID_TRANSITIONS = Object.freeze({
  [EXTRACTION_STATES.IDLE]:         [EXTRACTION_STATES.INITIALIZING],
  [EXTRACTION_STATES.INITIALIZING]: [EXTRACTION_STATES.SEARCHING, EXTRACTION_STATES.EXTRACTING, EXTRACTION_STATES.ERROR, EXTRACTION_STATES.STOPPING],
  [EXTRACTION_STATES.SEARCHING]:    [EXTRACTION_STATES.EXTRACTING, EXTRACTION_STATES.ERROR, EXTRACTION_STATES.STOPPING],
  [EXTRACTION_STATES.EXTRACTING]:   [EXTRACTION_STATES.SCROLLING, EXTRACTION_STATES.PROCESSING, EXTRACTION_STATES.PAUSED, EXTRACTION_STATES.COMPLETED, EXTRACTION_STATES.ERROR, EXTRACTION_STATES.STOPPING],
  [EXTRACTION_STATES.SCROLLING]:    [EXTRACTION_STATES.EXTRACTING, EXTRACTION_STATES.PROCESSING, EXTRACTION_STATES.PAUSED, EXTRACTION_STATES.COMPLETED, EXTRACTION_STATES.ERROR, EXTRACTION_STATES.STOPPING],
  [EXTRACTION_STATES.PROCESSING]:   [EXTRACTION_STATES.COMPLETED, EXTRACTION_STATES.ERROR, EXTRACTION_STATES.STOPPING],
  [EXTRACTION_STATES.PAUSED]:       [EXTRACTION_STATES.EXTRACTING, EXTRACTION_STATES.STOPPING, EXTRACTION_STATES.IDLE],
  [EXTRACTION_STATES.STOPPING]:     [EXTRACTION_STATES.IDLE],
  [EXTRACTION_STATES.COMPLETED]:    [EXTRACTION_STATES.IDLE, EXTRACTION_STATES.INITIALIZING],
  [EXTRACTION_STATES.ERROR]:        [EXTRACTION_STATES.IDLE, EXTRACTION_STATES.INITIALIZING],
});

export class ExtractionStateMachine {
  constructor() {
    this._state = EXTRACTION_STATES.IDLE;
    this._stats = {
      discovered: 0,
      valid: 0,
      duplicates: 0,
      errors: 0,
      aiFlagged: 0,
      startedAt: null,
    };
    this._config = null;
    this._platformStatuses = {};
    this._listeners = [];
  }

  get state() {
    return this._state;
  }

  get stats() {
    return { ...this._stats, platformStatuses: { ...this._platformStatuses } };
  }

  get config() {
    return this._config;
  }

  get isRunning() {
    return ![
      EXTRACTION_STATES.IDLE,
      EXTRACTION_STATES.COMPLETED,
      EXTRACTION_STATES.ERROR,
    ].includes(this._state);
  }

  get shouldStop() {
    return this._state === EXTRACTION_STATES.STOPPING || this._state === EXTRACTION_STATES.IDLE;
  }

  get isPaused() {
    return this._state === EXTRACTION_STATES.PAUSED;
  }

  onStateChange(fn) {
    this._listeners.push(fn);
  }

  transition(newState) {
    const valid = VALID_TRANSITIONS[this._state];
    if (!valid || !valid.includes(newState)) {
      logger.warn(`Invalid state transition: ${this._state} → ${newState}`);
      return false;
    }

    const oldState = this._state;
    this._state = newState;
    logger.info(`State: ${oldState} → ${newState}`);

    this._persist();

    for (const fn of this._listeners) {
      try {
        fn(newState, oldState, this.stats);
      } catch (err) {
        logger.error(`State listener error: ${err.message}`);
      }
    }

    return true;
  }

  start(config) {
    this._config = config;
    this._stats = {
      discovered: 0,
      valid: 0,
      duplicates: 0,
      errors: 0,
      aiFlagged: 0,
      startedAt: Date.now(),
    };
    this._platformStatuses = {};

    const platforms = Array.isArray(config.platforms) ? config.platforms : [config.platform];
    for (const p of platforms) {
      this._platformStatuses[p] = { status: WORKER_STATUS.RUNNING, count: 0, error: "" };
    }

    this.transition(EXTRACTION_STATES.INITIALIZING);
  }

  setPlatformStatus(platform, status, details = {}) {
    if (!this._platformStatuses[platform]) {
      this._platformStatuses[platform] = { status, count: 0, error: "" };
    }
    this._platformStatuses[platform].status = status;
    if (details.error) this._platformStatuses[platform].error = details.error;
    if (details.count != null) this._platformStatuses[platform].count = details.count;

    this._persist();
  }

  recordBatch(batch) {
    this._stats.discovered += (batch.added || 0) + (batch.duplicates || 0) + (batch.errors || 0);
    this._stats.valid += batch.added || 0;
    this._stats.duplicates += batch.duplicates || 0;
    this._stats.errors += batch.errors || 0;
    if (batch.aiFlagged) this._stats.aiFlagged += batch.aiFlagged;

    if (batch.platform && this._platformStatuses[batch.platform]) {
      this._platformStatuses[batch.platform].count = (this._platformStatuses[batch.platform].count || 0) + (batch.added || 0);
    }

    this._persist();
  }

  pause() {
    if (this._state === EXTRACTION_STATES.EXTRACTING || this._state === EXTRACTION_STATES.SCROLLING) {
      this.transition(EXTRACTION_STATES.PAUSED);
    }
  }

  resume() {
    if (this._state === EXTRACTION_STATES.PAUSED) {
      this.transition(EXTRACTION_STATES.EXTRACTING);
    }
  }

  stop() {
    if (this._state === EXTRACTION_STATES.IDLE) return;
    if (this._state === EXTRACTION_STATES.STOPPING) return;

    const oldState = this._state;
    this._state = EXTRACTION_STATES.STOPPING;
    logger.info(`State: ${oldState} → STOPPING (forced)`);

    for (const p of Object.keys(this._platformStatuses)) {
      if (this._platformStatuses[p].status === WORKER_STATUS.RUNNING) {
        this._platformStatuses[p].status = WORKER_STATUS.COMPLETED;
      }
    }

    this._persist();

    for (const fn of this._listeners) {
      try {
        fn(EXTRACTION_STATES.STOPPING, oldState, this.stats);
      } catch (err) {
        logger.error(`State listener error: ${err.message}`);
      }
    }
  }

  reset() {
    const oldState = this._state;
    this._state = EXTRACTION_STATES.IDLE;
    this._config = null;
    this._platformStatuses = {};
    logger.info(`State: ${oldState} → IDLE (reset)`);
    this._persist();

    for (const fn of this._listeners) {
      try {
        fn(EXTRACTION_STATES.IDLE, oldState, this.stats);
      } catch (err) {
        logger.error(`State listener error: ${err.message}`);
      }
    }
  }

  toSnapshot() {
    return {
      status: this._state,
      ...this._stats,
      platformStatuses: this._platformStatuses,
      platforms: this._config?.platforms || [],
      keywords: this._config?.keywords || [],
      limit: this._config?.limit || 0,
      region: this._config?.region || "",
    };
  }

  async restore() {
    try {
      const saved = await getExtractionState();
      if (saved && saved.status && saved.status !== EXTRACTION_STATES.IDLE) {
        logger.warn(`Restoring from interrupted state: ${saved.status} → IDLE`);
        this._stats = {
          discovered: saved.discovered || 0,
          valid: saved.valid || 0,
          duplicates: saved.duplicates || 0,
          errors: saved.errors || 0,
          aiFlagged: saved.aiFlagged || 0,
          startedAt: saved.startedAt || null,
        };
        this._platformStatuses = saved.platformStatuses || {};
        this._state = EXTRACTION_STATES.IDLE;
        await this._persist();
      }
    } catch (err) {
      logger.error(`Failed to restore state: ${err.message}`);
    }
  }

  async _persist() {
    try {
      await saveExtractionState(this.toSnapshot());
    } catch {
      // Non-critical
    }
  }
}

export const stateMachine = new ExtractionStateMachine();
