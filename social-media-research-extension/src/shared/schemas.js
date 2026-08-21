/**
 * schemas.js — Normalized record schema, validation, and creation helpers.
 *
 * Every extracted record passes through this layer before storage.
 * The schema includes reserved fields for future AI/ML dataset use (§47).
 */

import { PLATFORMS, MEDIA_TYPES } from "./constants.js";

/**
 * Create an empty record with all fields initialized.
 * @param {object} [overrides={}] - Values to merge over defaults.
 * @returns {object}
 */
export function createEmptyRecord(overrides = {}) {
  return {
    id: "",
    platform: "",
    caption: "",
    url: "",
    normalizedUrl: "",
    keywords: [],
    hashtags: [],
    author: "",
    authorUrl: "",
    publishedAt: "",
    collectedAt: new Date().toISOString(),
    mediaType: MEDIA_TYPES.UNKNOWN,
    extractionSource: "",
    region: "",
    status: "valid",
    error: "",

    // Reserved for future AI dataset use — not populated in V1
    fraud_category: null,
    fraud_probability: null,
    language: null,
    sentiment: null,
    risk_score: null,
    human_label: null,
    review_status: null,
    label_source: null,

    ...overrides,
  };
}

/**
 * Normalize a raw extracted record into the canonical schema shape.
 * Trims strings, deduplicates arrays, sets collectedAt if missing.
 * @param {object} raw
 * @returns {object}
 */
export function normalizeRecord(raw) {
  const record = createEmptyRecord();

  record.id = String(raw.id || "").trim();
  record.platform = String(raw.platform || "").trim().toLowerCase();
  record.caption = String(raw.caption || "").trim();
  record.url = String(raw.url || "").trim();
  record.normalizedUrl = String(raw.normalizedUrl || raw.url || "").trim();
  record.keywords = dedupeArray(ensureArray(raw.keywords).map((k) => String(k).trim()).filter(Boolean));
  record.hashtags = dedupeArray(ensureArray(raw.hashtags).map((h) => String(h).trim()).filter(Boolean));
  record.author = String(raw.author || "").trim();
  record.authorUrl = String(raw.authorUrl || "").trim();
  record.publishedAt = String(raw.publishedAt || "").trim();
  record.collectedAt = raw.collectedAt || new Date().toISOString();
  record.mediaType = String(raw.mediaType || MEDIA_TYPES.UNKNOWN).trim();
  record.extractionSource = String(raw.extractionSource || "").trim();
  record.region = String(raw.region || "").trim();
  record.status = raw.status === "error" ? "error" : "valid";
  record.error = String(raw.error || "").trim();

  return record;
}

/**
 * Validate a normalized record. Returns an object with `valid` and `errors`.
 * @param {object} record
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRecord(record) {
  const errors = [];

  if (!record.id) errors.push("Missing id");
  if (!record.platform) errors.push("Missing platform");
  if (!record.url) errors.push("Missing url");

  // Platform must be one of the known values
  const knownPlatforms = Object.values(PLATFORMS);
  if (record.platform && !knownPlatforms.includes(record.platform)) {
    errors.push(`Unknown platform: ${record.platform}`);
  }

  // URL basic sanity
  if (record.url && !record.url.startsWith("http")) {
    errors.push(`URL does not start with http: ${record.url}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Extract hashtags from a text string.
 * Handles Unicode hashtags (#financialscam, #आर्थिकधोखाधड़ी, etc.).
 * @param {string} text
 * @returns {string[]}
 */
export function extractHashtags(text) {
  if (!text) return [];
  // Match #word with Unicode support
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  return dedupeArray(matches.map((h) => h.toLowerCase()));
}

/**
 * Extract meaningful keywords from a text string.
 * Simple tokenization — not NLP. Filters out short/common words.
 * @param {string} text
 * @param {string[]} [searchTerms=[]] - Original search terms to match against.
 * @returns {string[]}
 */
export function extractKeywords(text, searchTerms = []) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return searchTerms.filter((term) => lower.includes(term.toLowerCase()));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureArray(val) {
  if (Array.isArray(val)) return val;
  if (val == null) return [];
  return [val];
}

function dedupeArray(arr) {
  return [...new Set(arr)];
}
