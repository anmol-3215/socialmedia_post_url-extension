/**
 * constants.js — Single source of truth for the extension.
 *
 * Every module (dashboard, service worker, content scripts) imports from here
 * so message-type strings, state names, and platform identifiers stay in sync.
 */

// ─── Message Types ───────────────────────────────────────────────────────────

export const MSG = Object.freeze({
  // Outbound — dashboard → service worker
  START_EXTRACTION: "START_EXTRACTION",
  STOP_EXTRACTION: "STOP_EXTRACTION",
  PAUSE_EXTRACTION: "PAUSE_EXTRACTION",
  RESUME_EXTRACTION: "RESUME_EXTRACTION",
  GET_SETTINGS: "GET_SETTINGS",
  SAVE_SETTINGS: "SAVE_SETTINGS",
  EXPORT_CSV: "EXPORT_CSV",
  EXPORT_XLSX: "EXPORT_XLSX",
  EXPORT_JSON: "EXPORT_JSON",
  GET_RESULTS: "GET_RESULTS",
  CLEAR_RESULTS: "CLEAR_RESULTS",

  // Inbound — service worker → dashboard
  EXTRACTION_STARTED: "EXTRACTION_STARTED",
  RESULT_FOUND: "RESULT_FOUND",
  RESULT_BATCH: "RESULT_BATCH",
  EXTRACTION_PROGRESS: "EXTRACTION_PROGRESS",
  EXTRACTION_COMPLETED: "EXTRACTION_COMPLETED",
  EXTRACTION_ERROR: "EXTRACTION_ERROR",
  PLATFORM_STATUS_UPDATE: "PLATFORM_STATUS_UPDATE",

  // Internal — service worker ↔ content script
  CS_INIT: "CS_INIT",
  CS_EXTRACT: "CS_EXTRACT",
  CS_RESULTS: "CS_RESULTS",
  CS_SCROLL: "CS_SCROLL",
  CS_STOP: "CS_STOP",
  CS_STATUS: "CS_STATUS",
  CS_ERROR: "CS_ERROR",

  // Logging
  LOG_ENTRY: "LOG_ENTRY",
});

// ─── Worker Statuses per platform ───────────────────────────────────────────

export const WORKER_STATUS = Object.freeze({
  READY: "READY",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  RATE_LIMITED: "RATE_LIMITED",
  PAUSED: "PAUSED",
  ERROR: "ERROR",
  DISABLED: "DISABLED",
});

// ─── Extraction States ───────────────────────────────────────────────────────

export const EXTRACTION_STATES = Object.freeze({
  IDLE: "IDLE",
  INITIALIZING: "INITIALIZING",
  SEARCHING: "SEARCHING",
  EXTRACTING: "EXTRACTING",
  SCROLLING: "SCROLLING",
  PROCESSING: "PROCESSING",
  PAUSED: "PAUSED",
  STOPPING: "STOPPING",
  COMPLETED: "COMPLETED",
  ERROR: "ERROR",
});

// ─── Platforms ───────────────────────────────────────────────────────────────

export const PLATFORMS = Object.freeze({
  YOUTUBE: "youtube",
  INSTAGRAM: "instagram",
  X: "x",
  FACEBOOK: "facebook",
  REDDIT: "reddit",
});

export const PLATFORM_LABELS = Object.freeze({
  [PLATFORMS.YOUTUBE]: "YouTube",
  [PLATFORMS.INSTAGRAM]: "Instagram",
  [PLATFORMS.X]: "X / Twitter",
  [PLATFORMS.FACEBOOK]: "Facebook",
  [PLATFORMS.REDDIT]: "Reddit",
});

// Support classification per prompt §42
export const SUPPORT_STATUS = Object.freeze({
  SUPPORTED: "SUPPORTED",
  PARTIALLY_SUPPORTED: "PARTIALLY_SUPPORTED",
  LIMITED_BY_PLATFORM: "LIMITED_BY_PLATFORM",
  REQUIRES_USER_NAVIGATION: "REQUIRES_USER_NAVIGATION",
  NOT_SUPPORTED: "NOT_SUPPORTED",
});

export const PLATFORM_CAPABILITIES = Object.freeze({
  [PLATFORMS.YOUTUBE]: {
    enabled: true,
    status: SUPPORT_STATUS.SUPPORTED,
    label: "SUPPORTED",
    mode: "search-results",
    regionSupport: "partial", // query modifier only
  },
  [PLATFORMS.INSTAGRAM]: {
    enabled: true,
    status: SUPPORT_STATUS.PARTIALLY_SUPPORTED,
    label: "PARTIALLY SUPPORTED — public browser context only",
    mode: "public-browser-context",
    regionSupport: "none",
  },
  [PLATFORMS.X]: {
    enabled: true,
    status: SUPPORT_STATUS.SUPPORTED,
    label: "SUPPORTED",
    mode: "search-results",
    regionSupport: "partial",
  },
  [PLATFORMS.FACEBOOK]: {
    enabled: false,
    status: SUPPORT_STATUS.LIMITED_BY_PLATFORM,
    label: "LIMITED BY PLATFORM",
    reason: "Facebook's dynamic rendering and access restrictions prevent reliable public extraction from a Chrome extension without bypassing platform controls. The adapter is scaffolded for future use.",
    mode: "disabled",
    regionSupport: "none",
  },
  [PLATFORMS.REDDIT]: {
    enabled: true,
    status: SUPPORT_STATUS.SUPPORTED,
    label: "SUPPORTED",
    mode: "search-results",
    regionSupport: "none",
  },
});

// ─── Extraction Limits ───────────────────────────────────────────────────────

export const EXTRACTION_LIMITS = Object.freeze([25, 100, 200, "unlimited"]);

// ─── Regions ─────────────────────────────────────────────────────────────────

export const REGIONS = Object.freeze({
  india: {
    label: "India",
    modifiers: ["India", "Indian", "INR", "UPI", "RBI", "SEBI"],
    support: "partial",
    description: "Partially supported — used as a search-query modifier, not verified geographic origin.",
  },
  asia: {
    label: "Asia",
    modifiers: ["Asia", "Asian"],
    support: "partial",
    description: "Partially supported — broad query modifier only.",
  },
  usa: {
    label: "USA",
    modifiers: ["USA", "US", "United States", "American"],
    support: "partial",
    description: "Partially supported — broad query modifier only.",
  },
  europe: {
    label: "Europe",
    modifiers: [],
    support: "none",
    description: "Not supported — no reliable public query modifier; used as a label only.",
  },
  uk: {
    label: "UK",
    modifiers: ["UK", "United Kingdom", "British"],
    support: "partial",
    description: "Partially supported — used as a search-query modifier only.",
  },
  middle_east: {
    label: "Middle East",
    modifiers: [],
    support: "none",
    description: "Not supported — no reliable public query modifier; used as a label only.",
  },
  global: {
    label: "Global",
    modifiers: [],
    support: "na",
    description: "Not applicable — no region filter is applied.",
  },
  custom: {
    label: "Custom",
    modifiers: [],
    support: "varies",
    description: "Depends on the custom term you provide; treated as a plain search-query modifier.",
  },
});

// ─── Extraction Config Defaults ──────────────────────────────────────────────

export const EXTRACTION_DEFAULTS = Object.freeze({
  scrollDelay: 1500,        // ms between scroll actions
  mutationDebounce: 800,    // ms to debounce MutationObserver callbacks
  batchSize: 10,            // records per RESULT_BATCH message
  maxScrollAttempts: 50,    // give up after this many consecutive scrolls with no new results
  stagnationThreshold: 3,   // scroll attempts with no new results before declaring stagnation
  extractionTimeout: 300000, // 5 minutes max per extraction session
  scrollPixels: 800,        // pixels to scroll per step
});

// ─── Platform Domains (for URL validation) ───────────────────────────────────

export const PLATFORM_DOMAINS = Object.freeze({
  [PLATFORMS.YOUTUBE]: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
  [PLATFORMS.INSTAGRAM]: ["instagram.com", "www.instagram.com"],
  [PLATFORMS.X]: ["x.com", "twitter.com", "www.x.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"],
  [PLATFORMS.FACEBOOK]: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"],
  [PLATFORMS.REDDIT]: ["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com"],
});

// ─── Media Types ─────────────────────────────────────────────────────────────

export const MEDIA_TYPES = Object.freeze({
  VIDEO: "video",
  SHORT: "short",
  POST: "post",
  REEL: "reel",
  IMAGE: "image",
  TEXT: "text",
  LINK: "link",
  UNKNOWN: "unknown",
});

// ─── Log Levels ──────────────────────────────────────────────────────────────

export const LOG_LEVELS = Object.freeze({
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
});
