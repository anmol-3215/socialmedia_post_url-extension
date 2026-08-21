/**
 * instagram-adapter.js — Platform adapter for Instagram hashtag pages and public feeds.
 *
 * Injected into instagram.com/explore/tags/ and public post pages.
 * Operates strictly in the public browser context. If Instagram restricts public
 * access or presents a login barrier, reports the limitation cleanly.
 */

(function () {
  "use strict";

  const NS = (window.__SMRT = window.__SMRT || {});
  const { BaseAdapter, DomUtils, ExtractorUtils } = NS;

  class InstagramAdapter extends BaseAdapter {
    constructor() {
      super("instagram");
    }

    getSelectors() {
      return {
        resultItem: [
          "div._aabd._aa8k._aanf",
          "article div a[href*='/p/']",
          "article div a[href*='/reel/']",
          "main a[href*='/p/']",
          "main a[href*='/reel/']",
          "div[style*='flex-direction: column'] a[href*='/p/']",
          "a[href*='/p/']",
          "a[href*='/reel/']",
        ],
        title: [
          "img[alt]",
          "div._aagv img",
          "span._aacl",
          "div._ae6q",
        ],
        url: [
          "self",
          "a[href*='/p/']",
          "a[href*='/reel/']",
        ],
        author: [
          "header a",
          "span._aacl._aaco._aacw",
          "a.x1i10hfl",
        ],
        authorUrl: [
          "header a",
          "a.x1i10hfl[href^='/']",
        ],
      };
    }

    getMediaType(element) {
      let href = element.tagName && element.tagName.toLowerCase() === "a" ? element.href : DomUtils.getHref(element, ["a"]);
      if (href && href.includes("/reel/")) return "reel";
      return "post";
    }

    extractFromElement(element) {
      // Check for login wall or restriction banners
      if (document.querySelector("div[role='dialog']") && document.querySelector("input[name='username']")) {
        console.warn("[instagram-adapter] Login dialog detected on page");
      }

      const selectors = this.getSelectors();

      // Extract URL (the element itself might be the <a> tag)
      let url = "";
      if (element.tagName && element.tagName.toLowerCase() === "a" && (element.href.includes("/p/") || element.href.includes("/reel/"))) {
        url = element.href;
      } else {
        url = DomUtils.getHref(element, selectors.url);
      }

      if (!url) return null;
      url = ExtractorUtils.toAbsoluteUrl(url);

      if (!url.includes("/p/") && !url.includes("/reel/")) {
        return null;
      }

      // Extract Caption (often stored in alt attribute of img inside the post tile)
      let caption = "";
      const img = element.querySelector("img[alt]") || (element.tagName.toLowerCase() === "img" ? element : null);
      if (img) {
        caption = img.getAttribute("alt") || "";
      }
      if (!caption) {
        caption = DomUtils.getTextContent(element, selectors.title);
      }
      caption = caption.trim();

      // Extract Author if visible
      const author = DomUtils.getTextContent(element, selectors.author);
      let authorUrl = DomUtils.getHref(element, selectors.authorUrl);
      if (authorUrl) authorUrl = ExtractorUtils.toAbsoluteUrl(authorUrl);

      const mediaType = this.getMediaType(element);
      const hashtags = ExtractorUtils.extractHashtags(caption);
      const keywords = ExtractorUtils.matchKeywords(caption, this._config?.keywords || []);

      return {
        caption,
        url,
        normalizedUrl: url,
        author,
        authorUrl,
        publishedAt: "",
        mediaType,
        hashtags,
        keywords,
      };
    }
  }

  // Register and initialize adapter
  NS.initAdapter(new InstagramAdapter());
})();
