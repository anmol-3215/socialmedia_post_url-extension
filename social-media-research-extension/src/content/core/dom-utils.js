/**
 * dom-utils.js — DOM querying utilities for content scripts.
 *
 * Injected into platform pages via chrome.scripting.executeScript.
 * NOT an ES module — uses a global namespace shared with other content scripts.
 *
 * Provides:
 *   - Multi-selector fallback querying
 *   - Safe text extraction
 *   - Element visibility checks
 *   - Selector health diagnostics
 */

(function () {
  "use strict";

  const NS = (window.__SMRT = window.__SMRT || {});

  // ─── Query with Fallbacks ──────────────────────────────────────────────────

  /**
   * Try multiple CSS selectors in order, return elements from the first match.
   * @param {string[]} selectors - CSS selectors to try, highest-confidence first.
   * @param {Element|Document} [root=document] - Root element to query from.
   * @returns {Element[]} Matching elements (empty array if none found).
   */
  function queryWithFallbacks(selectors, root) {
    root = root || document;
    for (const sel of selectors) {
      try {
        const found = root.querySelectorAll(sel);
        if (found.length > 0) return Array.from(found);
      } catch {
        // Invalid selector — skip silently
      }
    }
    return [];
  }

  /**
   * Query a single element using fallback selectors.
   * @param {string[]} selectors
   * @param {Element|Document} [root=document]
   * @returns {Element|null}
   */
  function queryOneWithFallbacks(selectors, root) {
    root = root || document;
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch {
        // skip
      }
    }
    return null;
  }

  // ─── Text Extraction ───────────────────────────────────────────────────────

  /**
   * Safely extract text content from an element using fallback selectors.
   * @param {Element} element - Parent element to search within.
   * @param {string[]} selectors - Selectors to try within the parent.
   * @returns {string} Trimmed text, or empty string if not found.
   */
  function getTextContent(element, selectors) {
    if (!element) return "";
    if (!selectors || selectors.length === 0) {
      return (element.textContent || "").trim();
    }
    const child = queryOneWithFallbacks(selectors, element);
    return child ? (child.textContent || "").trim() : "";
  }

  /**
   * Get an attribute value from an element found via fallback selectors.
   * @param {Element} element - Parent element.
   * @param {string[]} selectors - Selectors to try.
   * @param {string} attr - Attribute name.
   * @returns {string} Attribute value or empty string.
   */
  function getAttribute(element, selectors, attr) {
    if (!element) return "";
    const child = queryOneWithFallbacks(selectors, element);
    return child ? (child.getAttribute(attr) || "") : "";
  }

  /**
   * Get href from a link element found via fallback selectors.
   * Returns the full resolved URL.
   * @param {Element} element - Parent element.
   * @param {string[]} selectors - Selectors for <a> elements.
   * @returns {string} Full URL or empty string.
   */
  function getHref(element, selectors) {
    if (!element) return "";
    const link = queryOneWithFallbacks(selectors, element);
    return link ? (link.href || link.getAttribute("href") || "") : "";
  }

  // ─── Visibility ────────────────────────────────────────────────────────────

  /**
   * Check if an element is visible in the viewport.
   * @param {Element} el
   * @returns {boolean}
   */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ─── Diagnostics ───────────────────────────────────────────────────────────

  /**
   * Selector health check — logs a diagnostic when zero results are found.
   * @param {string} context - Where this check is happening (e.g., "youtube-adapter").
   * @param {string[]} selectors - The selectors that were tried.
   * @param {number} expectedMin - Minimum expected results.
   * @param {number} found - How many were actually found.
   * @returns {{ healthy: boolean, message: string }}
   */
  function selectorHealthCheck(context, selectors, expectedMin, found) {
    if (found >= expectedMin) {
      return { healthy: true, message: `[${context}] Selector OK: found ${found} elements` };
    }

    const message = [
      `[${context}] SELECTOR HEALTH WARNING`,
      `  Expected at least: ${expectedMin}`,
      `  Detected: ${found}`,
      `  Selectors tried: ${selectors.join(", ")}`,
      `  Possible cause: Platform DOM structure may have changed.`,
      `  Page URL: ${window.location.href}`,
    ].join("\n");

    console.warn(message);
    return { healthy: false, message };
  }

  // ─── Export to namespace ───────────────────────────────────────────────────

  NS.DomUtils = {
    queryWithFallbacks,
    queryOneWithFallbacks,
    getTextContent,
    getAttribute,
    getHref,
    isElementVisible,
    selectorHealthCheck,
  };
})();
