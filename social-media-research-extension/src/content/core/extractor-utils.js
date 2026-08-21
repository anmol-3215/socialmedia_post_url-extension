/**
 * extractor-utils.js — Shared utilities for content script extractors.
 *
 * Provides:
 *   - Message type constants (duplicated from shared/constants.js since
 *     content scripts are injected as non-module files)
 *   - Batched result messaging to the service worker
 *   - Status/error reporting
 *   - Hashtag extraction (Unicode-aware)
 *   - Record ID generation
 *
 * Depends on: dom-utils.js, scroll-manager.js (must be injected first)
 */

(function () {
  "use strict";

  const NS = (window.__SMRT = window.__SMRT || {});

  // ─── Message Types (mirrored from src/shared/constants.js) ─────────────────
  // These must stay in sync with the service worker's constants.

  NS.MSG = Object.freeze({
    CS_INIT: "CS_INIT",
    CS_EXTRACT: "CS_EXTRACT",
    CS_RESULTS: "CS_RESULTS",
    CS_SCROLL: "CS_SCROLL",
    CS_STOP: "CS_STOP",
    CS_STATUS: "CS_STATUS",
    CS_ERROR: "CS_ERROR",
  });

  // Default batch size for grouping results before sending
  NS.BATCH_SIZE = 10;

  // ─── Messaging ─────────────────────────────────────────────────────────────

  /**
   * Send a batch of extracted results to the service worker.
   * @param {object[]} results - Array of raw result records.
   * @returns {Promise<void>}
   */
  async function sendResultBatch(results) {
    if (!results || results.length === 0) return;
    try {
      await chrome.runtime.sendMessage({
        type: NS.MSG.CS_RESULTS,
        payload: { results },
      });
    } catch (err) {
      console.error("[extractor-utils] Failed to send results:", err.message);
    }
  }

  /**
   * Send a status update to the service worker.
   * @param {string} status - e.g. "EXTRACTING", "SCROLLING", "COMPLETED", "ERROR"
   * @param {string} [message=""]
   */
  function sendStatus(status, message) {
    try {
      chrome.runtime.sendMessage({
        type: NS.MSG.CS_STATUS,
        payload: { status, message: message || "" },
      });
    } catch (err) {
      console.error("[extractor-utils] Failed to send status:", err.message);
    }
  }

  /**
   * Send an error to the service worker.
   * @param {string} message
   * @param {object} [details={}]
   */
  function sendError(message, details) {
    try {
      chrome.runtime.sendMessage({
        type: NS.MSG.CS_ERROR,
        payload: { message, ...(details || {}) },
      });
    } catch (err) {
      console.error("[extractor-utils] Failed to send error:", err.message);
    }
  }

  // ─── Hashtag & Keyword Extraction ──────────────────────────────────────────

  /**
   * Extract hashtags from text. Supports Unicode (Hindi, emoji, etc.).
   * @param {string} text
   * @returns {string[]} Lowercase hashtags including the # prefix.
   */
  function extractHashtags(text) {
    if (!text) return [];
    const matches = text.match(/#[\p{L}\p{N}_]+/gu) || [];
    return [...new Set(matches.map((h) => h.toLowerCase()))];
  }

  /**
   * Check if any of the search keywords appear in the text.
   * @param {string} text
   * @param {string[]} searchTerms
   * @returns {string[]} Matching keywords.
   */
  function matchKeywords(text, searchTerms) {
    if (!text || !searchTerms) return [];
    const lower = text.toLowerCase();
    return searchTerms.filter((term) => lower.includes(term.toLowerCase()));
  }

  // ─── ID Generation ─────────────────────────────────────────────────────────

  /**
   * Generate a stable record ID from a URL and platform.
   * Falls back to a random ID if the URL can't be parsed.
   * @param {string} url
   * @param {string} platform
   * @returns {string}
   */
  function generateRecordId(url, platform) {
    if (!url) {
      return `${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    try {
      const parsed = new URL(url);
      const path = parsed.pathname;

      switch (platform) {
        case "youtube": {
          const v = parsed.searchParams.get("v");
          if (v) return `yt-${v}`;
          const shortsMatch = path.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
          if (shortsMatch) return `yt-${shortsMatch[1]}`;
          if (parsed.hostname === "youtu.be") {
            const id = path.slice(1).split("/")[0];
            if (id) return `yt-${id}`;
          }
          break;
        }
        case "instagram": {
          const igMatch = path.match(/\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
          if (igMatch) return `ig-${igMatch[1]}`;
          break;
        }
        case "x": {
          const xMatch = path.match(/\/[^/]+\/status\/(\d+)/);
          if (xMatch) return `x-${xMatch[1]}`;
          break;
        }
        case "facebook": {
          const fbMatch = path.match(/\/(?:posts|videos|watch|reel)\/(\d+)/) ||
            path.match(/\/(\d{10,})$/);
          if (fbMatch) return `fb-${fbMatch[1]}`;
          break;
        }
        case "reddit": {
          const rdMatch = path.match(/\/comments\/([a-z0-9]+)/i);
          if (rdMatch) return `rd-${rdMatch[1]}`;
          break;
        }
      }
    } catch {
      // URL parse error — fall through to random ID
    }

    return `${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ─── URL Helpers ───────────────────────────────────────────────────────────

  /**
   * Check if a URL belongs to the expected platform.
   * @param {string} rawUrl
   * @param {string} platform
   * @returns {boolean}
   */
  function isUrlForPlatform(rawUrl, platform) {
    if (!rawUrl) return false;
    try {
      const hostname = new URL(rawUrl).hostname.toLowerCase();
      const domains = {
        youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
        instagram: ["instagram.com", "www.instagram.com"],
        x: ["x.com", "twitter.com", "www.x.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"],
        facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"],
        reddit: ["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com"],
      };
      const valid = domains[platform] || [];
      return valid.some((d) => hostname === d || hostname.endsWith("." + d));
    } catch {
      return false;
    }
  }

  /**
   * Make a relative URL absolute.
   * @param {string} url
   * @returns {string}
   */
  function toAbsoluteUrl(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    try {
      return new URL(url, window.location.origin).href;
    } catch {
      return url;
    }
  }

  // ─── Export to namespace ───────────────────────────────────────────────────

  NS.ExtractorUtils = {
    sendResultBatch,
    sendStatus,
    sendError,
    extractHashtags,
    matchKeywords,
    generateRecordId,
    isUrlForPlatform,
    toAbsoluteUrl,
  };
})();
