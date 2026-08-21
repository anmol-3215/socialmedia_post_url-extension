/**
 * youtube-adapter.js — Platform adapter for YouTube search results & Shorts.
 *
 * Injected into youtube.com search result pages.
 * Extends BaseAdapter to extract publicly accessible video title, URL, channel,
 * publication time, and hashtags.
 */

(function () {
  "use strict";

  const NS = (window.__SMRT = window.__SMRT || {});
  const { BaseAdapter, DomUtils, ExtractorUtils } = NS;

  class YouTubeAdapter extends BaseAdapter {
    constructor() {
      super("youtube");
    }

    getSelectors() {
      return {
        resultItem: [
          "ytd-video-renderer",
          "ytd-reel-item-renderer",
          "ytd-rich-item-renderer",
          "ytd-grid-video-renderer",
          "ytd-compact-video-renderer",
        ],
        title: [
          "#video-title",
          "yt-formatted-string#video-title",
          "a#video-title",
          "h3 a",
          "#video-title-link",
          "span#video-title",
          "#reel-title",
        ],
        url: [
          "a#video-title",
          "a#video-title-link",
          "a#thumbnail",
          "a[href*='/watch']",
          "a[href*='/shorts/']",
        ],
        author: [
          "#channel-name #text",
          "ytd-channel-name a",
          "#channel-info #text",
          "yt-formatted-string#byline",
          "a.yt-user-name",
        ],
        authorUrl: [
          "#channel-name a",
          "ytd-channel-name a",
          "a.yt-user-name",
        ],
        publishedAt: [
          "#metadata-line span:last-child",
          "div#metadata-line span.inline-metadata-item",
          "span.ytd-video-meta-block",
        ],
      };
    }

    getMediaType(element) {
      if (element.tagName && element.tagName.toLowerCase() === "ytd-reel-item-renderer") {
        return "short";
      }
      const href = DomUtils.getHref(element, this.getSelectors().url);
      if (href.includes("/shorts/")) {
        return "short";
      }
      return "video";
    }

    extractFromElement(element) {
      // Skip if this is a channel, playlist, or movie renderer
      const tag = element.tagName ? element.tagName.toLowerCase() : "";
      if (tag === "ytd-channel-renderer" || tag === "ytd-playlist-renderer" || tag === "ytd-radio-renderer") {
        return null;
      }

      const selectors = this.getSelectors();

      // Extract URL
      let url = DomUtils.getHref(element, selectors.url);
      if (!url) return null;

      url = ExtractorUtils.toAbsoluteUrl(url);

      // Must be a watch or shorts URL
      if (!url.includes("/watch") && !url.includes("/shorts/")) {
        return null;
      }

      // Extract Title / Caption
      let caption = DomUtils.getTextContent(element, selectors.title);
      if (!caption) {
        // Fallback: title attribute on thumbnail or title link
        caption = DomUtils.getAttribute(element, selectors.url, "title") ||
                  DomUtils.getAttribute(element, selectors.title, "aria-label") || "";
      }
      caption = caption.trim();

      // Extract Author / Channel
      const author = DomUtils.getTextContent(element, selectors.author);
      let authorUrl = DomUtils.getHref(element, selectors.authorUrl);
      if (authorUrl) authorUrl = ExtractorUtils.toAbsoluteUrl(authorUrl);

      // Extract Publication Info / Time
      const publishedAt = DomUtils.getTextContent(element, selectors.publishedAt);

      // Media type
      const mediaType = this.getMediaType(element);

      // Hashtags & keywords
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
  NS.initAdapter(new YouTubeAdapter());
})();
