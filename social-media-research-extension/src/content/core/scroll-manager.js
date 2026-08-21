/**
 * scroll-manager.js — Controlled infinite-scroll handler for content scripts.
 *
 * Provides:
 *   - Controlled, throttled scrolling
 *   - MutationObserver integration for detecting new content
 *   - Stagnation detection (stop after N scrolls with no new results)
 *   - Clean teardown on stop
 *
 * Depends on: dom-utils.js (must be injected first)
 */

(function () {
  "use strict";

  const NS = (window.__SMRT = window.__SMRT || {});

  /**
   * ScrollManager — manages the scroll → observe → extract cycle.
   *
   * @param {object} options
   * @param {number} [options.scrollDelay=1500] - ms between scroll actions
   * @param {number} [options.scrollPixels=800] - pixels to scroll per step
   * @param {number} [options.mutationDebounce=800] - ms to debounce observer callbacks
   * @param {number} [options.maxScrollAttempts=50] - max scroll attempts before giving up
   * @param {number} [options.stagnationThreshold=3] - consecutive empty scrolls before stop
   */
  class ScrollManager {
    constructor(options) {
      const defaults = {
        scrollDelay: 1500,
        scrollPixels: 800,
        mutationDebounce: 800,
        maxScrollAttempts: 50,
        stagnationThreshold: 3,
      };
      const config = { ...defaults, ...options };

      this.scrollDelay = config.scrollDelay;
      this.scrollPixels = config.scrollPixels;
      this.mutationDebounce = config.mutationDebounce;
      this.maxScrollAttempts = config.maxScrollAttempts;
      this.stagnationThreshold = config.stagnationThreshold;

      this._observer = null;
      this._scrollCount = 0;
      this._stagnationCount = 0;
      this._stopped = false;
      this._mutationCallbackTimer = null;
      this._onNewContent = null;
    }

    /**
     * Whether the manager has been stopped.
     */
    get isStopped() {
      return this._stopped;
    }

    /**
     * Start observing DOM mutations for new content.
     * @param {Element} [target=document.body] - Element to observe.
     * @param {function} onNewContent - Called when new content is detected.
     */
    startObserving(target, onNewContent) {
      this._onNewContent = onNewContent;
      this._stopped = false;

      if (this._observer) this.stopObserving();

      this._observer = new MutationObserver(() => {
        // Debounce mutation callbacks to avoid processing partial DOM updates
        if (this._mutationCallbackTimer) clearTimeout(this._mutationCallbackTimer);
        this._mutationCallbackTimer = setTimeout(() => {
          if (!this._stopped && this._onNewContent) {
            this._onNewContent();
          }
        }, this.mutationDebounce);
      });

      this._observer.observe(target || document.body, {
        childList: true,
        subtree: true,
      });
    }

    /**
     * Stop the MutationObserver.
     */
    stopObserving() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      if (this._mutationCallbackTimer) {
        clearTimeout(this._mutationCallbackTimer);
        this._mutationCallbackTimer = null;
      }
    }

    /**
     * Scroll down and wait for new content.
     * @param {number} [previousCount=0] - Number of results before scrolling.
     * @returns {Promise<{ scrolled: boolean, reason: string }>}
     */
    async scrollAndWait(previousCount) {
      if (this._stopped) {
        return { scrolled: false, reason: "stopped" };
      }

      this._scrollCount++;

      // Check max scroll attempts
      if (this._scrollCount > this.maxScrollAttempts) {
        return { scrolled: false, reason: "max_scroll_attempts_reached" };
      }

      // Scroll down
      window.scrollBy({ top: this.scrollPixels, behavior: "smooth" });

      // Wait for content to load
      await this._delay(this.scrollDelay);

      if (this._stopped) {
        return { scrolled: false, reason: "stopped" };
      }

      return { scrolled: true, reason: "ok" };
    }

    /**
     * Record the result of a scroll + extract cycle for stagnation detection.
     * @param {number} newResultsCount - Number of new (non-duplicate) results found.
     * @returns {{ stagnant: boolean, stagnationCount: number }}
     */
    recordScrollResult(newResultsCount) {
      if (newResultsCount === 0) {
        this._stagnationCount++;
      } else {
        this._stagnationCount = 0;
      }

      return {
        stagnant: this._stagnationCount >= this.stagnationThreshold,
        stagnationCount: this._stagnationCount,
      };
    }

    /**
     * Check if we've reached the bottom of the page.
     * @returns {boolean}
     */
    isAtBottom() {
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;
      // Consider "at bottom" if within 100px of the end
      return scrollTop + clientHeight >= scrollHeight - 100;
    }

    /**
     * Scroll to the top of the page.
     */
    scrollToTop() {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    /**
     * Stop all scrolling and observing. Sets the stopped flag.
     */
    stop() {
      this._stopped = true;
      this.stopObserving();
    }

    /**
     * Reset the manager for a new extraction session.
     */
    reset() {
      this.stop();
      this._scrollCount = 0;
      this._stagnationCount = 0;
      this._stopped = false;
    }

    /**
     * Get current stats.
     */
    get stats() {
      return {
        scrollCount: this._scrollCount,
        stagnationCount: this._stagnationCount,
        stopped: this._stopped,
      };
    }

    // ─── Private ───────────────────────────────────────────────────────────

    _delay(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        // Check stop flag periodically
        if (this._stopped) {
          clearTimeout(timer);
          resolve();
        }
      });
    }
  }

  NS.ScrollManager = ScrollManager;
})();
