/**
 * x-adapter.js — Platform adapter for X / Twitter search results.
 *
 * Injected into x.com and twitter.com search result pages.
 * Extracts publicly accessible tweet text, URL, author, timestamps, and hashtags.
 */

(function () {
  "use strict";

  const NS = (window.__SMRT = window.__SMRT || {});
  const { BaseAdapter, DomUtils, ExtractorUtils } = NS;

  class XAdapter extends BaseAdapter {
    constructor() {
      super("x");
    }

    getSelectors() {
      return {
        resultItem: [
          "article[data-testid='tweet']",
          "div[data-testid='cellInnerDiv'] article",
          "article[role='article']",
        ],
        title: [
          "div[data-testid='tweetText']",
          "div[lang]",
          "div.css-1rynq56.r-8akbws",
        ],
        url: [
          "a[href*='/status/']",
          "time",
        ],
        author: [
          "div[data-testid='User-Name']",
          "div[data-testid='User-Name'] span",
          "a[role='link'] div[dir='ltr']",
        ],
        authorUrl: [
          "div[data-testid='User-Name'] a",
          "a[role='link'][href^='/']",
        ],
        publishedAt: [
          "time",
          "a[href*='/status/'] time",
        ],
      };
    }

    getMediaType(element) {
      if (element.querySelector("div[data-testid='videoPlayer']") || element.querySelector("video")) {
        return "video";
      }
      if (element.querySelector("div[data-testid='tweetPhoto']") || element.querySelector("img[alt='Image']")) {
        return "image";
      }
      return "text";
    }

    extractFromElement(element) {
      const selectors = this.getSelectors();

      // Find status URL: typically an <a> tag linking to /status/<id>
      const statusLinks = element.querySelectorAll("a[href*='/status/']");
      let url = "";
      for (const a of statusLinks) {
        if (a.href && /\/status\/\d+/.test(a.href)) {
          url = a.href;
          break;
        }
      }

      if (!url) {
        // Try fallback selector
        url = DomUtils.getHref(element, selectors.url);
      }

      if (!url || !/\/status\/\d+/.test(url)) {
        return null;
      }

      url = ExtractorUtils.toAbsoluteUrl(url);

      // Extract Tweet text / caption
      let caption = DomUtils.getTextContent(element, selectors.title);
      caption = caption.trim();

      // Extract Author
      let author = "";
      const authorContainer = element.querySelector("div[data-testid='User-Name']");
      if (authorContainer) {
        // First line is often display name, handle follows
        const parts = authorContainer.textContent.split("@");
        author = parts.length > 1 ? `@${parts[1].trim().split("·")[0].trim()}` : authorContainer.textContent.trim();
      } else {
        author = DomUtils.getTextContent(element, selectors.author);
      }

      let authorUrl = DomUtils.getHref(element, selectors.authorUrl);
      if (authorUrl) authorUrl = ExtractorUtils.toAbsoluteUrl(authorUrl);

      // Extract Timestamp
      let publishedAt = "";
      const timeEl = element.querySelector("time");
      if (timeEl) {
        publishedAt = timeEl.getAttribute("datetime") || timeEl.textContent.trim();
      }

      const mediaType = this.getMediaType(element);
      const hashtags = ExtractorUtils.extractHashtags(caption);
      const keywords = ExtractorUtils.matchKeywords(caption, this._config?.keywords || []);

      return {
        caption,
        url,
        normalizedUrl: url,
        author,
        authorUrl,
        publishedAt,
        mediaType,
        hashtags,
        keywords,
      };
    }
  }

  // Register and initialize adapter
  NS.initAdapter(new XAdapter());
})();
