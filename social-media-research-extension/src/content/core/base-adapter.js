/**
 * base-adapter.js — Abstract base class for platform adapters.
 *
 * Implements the extract → scroll → extract loop with:
 *   - MutationObserver-driven content detection
 *   - Stagnation detection
 *   - Batched result messaging
 *   - Clean stop mechanism
 *   - Limit enforcement
 *
 * Platform-specific adapters extend this and override:
 *   - getSelectors()    → platform-specific CSS selectors
 *   - extractFromElement(el) → extract data from a single result element
 *   - getMediaType(el)  → classify the content type (optional)
 *
 * Depends on: dom-utils.js, scroll-manager.js, extractor-utils.js
 */

(function () {
  "use strict";

  const NS = (window.__SMRT = window.__SMRT || {});
  const { DomUtils, ScrollManager, ExtractorUtils } = NS;

  class BaseAdapter {
    /**
     * @param {string} platform - Platform identifier (e.g., "youtube", "reddit").
     */
    constructor(platform) {
      this.platform = platform;
      this._config = null;
      this._scrollManager = null;
      this._stopped = false;
      this._extractedUrls = new Set();  // Local dedup within this session
      this._resultBuffer = [];
      this._validCount = 0;
    }

    // ─── Methods to Override ───────────────────────────────────────────────

    /**
     * Return the CSS selectors for this platform.
     * Must be overridden by subclass.
     * @returns {{ resultItem: string[], title: string[], url: string[], author: string[], time: string[] }}
     */
    getSelectors() {
      throw new Error("getSelectors() must be overridden by the platform adapter");
    }

    /**
     * Extract data from a single result element.
     * Must be overridden by subclass.
     * @param {Element} element - A result item element.
     * @returns {object|null} Raw record object or null if should be skipped.
     */
    extractFromElement(element) {
      throw new Error("extractFromElement() must be overridden by the platform adapter");
    }

    /**
     * Optional: classify the media type of a result element.
     * @param {Element} element
     * @returns {string} Media type ("video", "short", "post", "reel", etc.)
     */
    getMediaType(element) {
      return "unknown";
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    /**
     * Initialize the adapter with extraction config.
     * Called when CS_INIT message is received.
     * @param {object} config - { platform, keywords, limit, region, settings }
     */
    init(config) {
      this._config = config;
      this._stopped = false;
      this._extractedUrls = new Set();
      this._resultBuffer = [];
      this._validCount = 0;

      const settings = config.settings || {};
      this._scrollManager = new ScrollManager({
        scrollDelay: settings.scrollDelay || 1500,
        scrollPixels: settings.scrollPixels || 800,
        mutationDebounce: settings.mutationDebounce || 800,
        maxScrollAttempts: settings.maxScrollAttempts || 50,
        stagnationThreshold: settings.stagnationThreshold || 3,
      });

      this._batchSize = settings.batchSize || 10;
      this._limit = config.limit;

      console.log(`[${this.platform}-adapter] Initialized with config:`, config);
    }

    /**
     * Start the extraction loop.
     */
    async start() {
      if (!this._config) {
        ExtractorUtils.sendError("Adapter not initialized — no config received");
        return;
      }

      console.log(`[${this.platform}-adapter] Starting extraction`);
      ExtractorUtils.sendStatus("EXTRACTING", "Beginning initial extraction");

      try {
        // Wait a moment for the page to stabilize
        await this._delay(1000);

        // Start the MutationObserver
        this._scrollManager.startObserving(document.body, () => {
          // New content detected — will be picked up in the next extraction cycle
        });

        // Main extraction loop
        await this._extractionLoop();

      } catch (err) {
        console.error(`[${this.platform}-adapter] Extraction error:`, err);
        ExtractorUtils.sendError(`Extraction failed: ${err.message}`);
      }
    }

    /**
     * Stop the extraction cleanly.
     */
    stop() {
      console.log(`[${this.platform}-adapter] Stop requested`);
      this._stopped = true;

      if (this._scrollManager) {
        this._scrollManager.stop();
      }

      // Flush any buffered results
      this._flushBuffer();

      ExtractorUtils.sendStatus("COMPLETED", "Extraction stopped by user");
    }

    // ─── Core Extraction Loop ──────────────────────────────────────────────

    async _extractionLoop() {
      let loopCount = 0;
      const maxLoops = 200; // Safety limit

      while (!this._stopped && loopCount < maxLoops) {
        loopCount++;

        // Check if we've reached the limit
        if (this._isLimitReached()) {
          console.log(`[${this.platform}-adapter] Limit reached: ${this._validCount}`);
          this._flushBuffer();
          ExtractorUtils.sendStatus("COMPLETED", `Extraction complete — ${this._validCount} results collected`);
          break;
        }

        // Extract results from currently visible elements
        ExtractorUtils.sendStatus("EXTRACTING", `Extracting... (${this._validCount} results so far)`);
        const newCount = this._extractVisible();

        // Send buffered results immediately so the dashboard updates in real time
        if (this._resultBuffer.length > 0) {
          await this._flushBuffer();
        }

        // Record scroll result for stagnation detection
        const { stagnant } = this._scrollManager.recordScrollResult(newCount);

        if (stagnant) {
          console.log(`[${this.platform}-adapter] Stagnation detected after ${this._scrollManager.stats.scrollCount} scrolls`);
          this._flushBuffer();
          ExtractorUtils.sendStatus("COMPLETED", `Extraction complete — stagnation detected after ${this._validCount} results`);
          break;
        }

        // Check if at bottom of page
        if (this._scrollManager.isAtBottom() && newCount === 0) {
          console.log(`[${this.platform}-adapter] Reached bottom of page`);
          this._flushBuffer();
          ExtractorUtils.sendStatus("COMPLETED", `Extraction complete — reached end of results (${this._validCount} results)`);
          break;
        }

        // Scroll for more content
        ExtractorUtils.sendStatus("SCROLLING", `Scrolling for more results...`);
        const { scrolled, reason } = await this._scrollManager.scrollAndWait();

        if (!scrolled) {
          if (reason === "stopped") break;
          console.log(`[${this.platform}-adapter] Scrolling ended: ${reason}`);
          this._flushBuffer();
          ExtractorUtils.sendStatus("COMPLETED", `Extraction complete — ${reason} (${this._validCount} results)`);
          break;
        }
      }

      // Final flush
      this._flushBuffer();

      if (loopCount >= maxLoops) {
        ExtractorUtils.sendStatus("COMPLETED", `Extraction complete — safety loop limit reached (${this._validCount} results)`);
      }

      // Cleanup
      if (this._scrollManager) {
        this._scrollManager.stopObserving();
      }
    }

    /**
     * Extract results from currently visible elements.
     * @returns {number} Number of new (non-duplicate) results found.
     */
    _extractVisible() {
      const selectors = this.getSelectors();
      const elements = DomUtils.queryWithFallbacks(selectors.resultItem);

      // Run health check on first extraction
      if (this._validCount === 0 && elements.length === 0) {
        DomUtils.selectorHealthCheck(
          this.platform,
          selectors.resultItem,
          1,
          elements.length
        );
      }

      let newCount = 0;

      for (const el of elements) {
        if (this._stopped) break;
        if (this._isLimitReached()) break;

        // Skip invisible elements
        if (!DomUtils.isElementVisible(el)) continue;

        try {
          const record = this.extractFromElement(el);
          if (!record) continue;

          // Ensure required fields
          record.platform = this.platform;
          record.collectedAt = new Date().toISOString();
          record.region = this._config.region || "";
          record.extractionSource = "content-script";
          record.status = "valid";

          // Generate ID if missing
          if (!record.id) {
            record.id = ExtractorUtils.generateRecordId(record.url, this.platform);
          }

          // Local dedup (within this content script session)
          const dedupKey = record.id || record.url;
          if (this._extractedUrls.has(dedupKey)) continue;

          // Validate URL belongs to platform
          if (record.url && !ExtractorUtils.isUrlForPlatform(record.url, this.platform)) {
            continue;
          }

          this._extractedUrls.add(dedupKey);
          this._resultBuffer.push(record);
          this._validCount++;
          newCount++;

        } catch (err) {
          console.warn(`[${this.platform}-adapter] Error extracting element:`, err.message);
        }
      }

      return newCount;
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    _isLimitReached() {
      if (this._limit === "unlimited") return false;
      return this._validCount >= this._limit;
    }

    async _flushBuffer() {
      if (this._resultBuffer.length === 0) return;
      const batch = this._resultBuffer.splice(0);
      await ExtractorUtils.sendResultBatch(batch);
    }

    _delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  // ─── Message Listener Setup ──────────────────────────────────────────────
  // The platform adapter file (e.g., youtube-adapter.js) creates an instance
  // and calls NS.initAdapter(adapterInstance) to wire up message handling.

  /**
   * Initialize a platform adapter and wire up message handling.
   * @param {BaseAdapter} adapter - Instance of a platform-specific adapter.
   */
  function initAdapter(adapter) {
    // Prevent double-initialization
    if (NS._adapterInitialized) {
      console.warn("[base-adapter] Adapter already initialized — ignoring");
      return;
    }
    NS._adapterInitialized = true;
    NS._activeAdapter = adapter;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type) return false;

      switch (message.type) {
        case NS.MSG.CS_INIT:
          adapter.init(message.payload);
          adapter.start();
          sendResponse({ ok: true });
          return false;

        case NS.MSG.CS_STOP:
          adapter.stop();
          sendResponse({ ok: true });
          return false;

        default:
          return false;
      }
    });

    console.log(`[base-adapter] Adapter registered for: ${adapter.platform}`);
  }

  // ─── Export to namespace ───────────────────────────────────────────────

  NS.BaseAdapter = BaseAdapter;
  NS.initAdapter = initAdapter;
})();
