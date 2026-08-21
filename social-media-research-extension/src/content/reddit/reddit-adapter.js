/**
 * reddit-adapter.js — Platform adapter for Reddit search results.
 *
 * Injected into reddit.com/search/ pages.
 * Handles both new Reddit, shreddit (current modern web), and legacy layouts.
 * Extracts post title, URL, subreddit, author, publication timestamp, and keywords/hashtags.
 */

(function () {
  "use strict";

  const NS = (window.__SMRT = window.__SMRT || {});
  const { BaseAdapter, DomUtils, ExtractorUtils } = NS;

  class RedditAdapter extends BaseAdapter {
    constructor() {
      super("reddit");
    }

    getSelectors() {
      return {
        resultItem: [
          "shreddit-post",
          "div[data-testid='post-container']",
          "div.Post",
          "div[data-testid='search-post-unit']",
          "article",
          "div.search-result-link",
        ],
        title: [
          "a[slot='title']",
          "h3",
          "a[data-testid='post-title']",
          "a.title",
          "h2 a",
          "a[href*='/comments/'] h3",
        ],
        url: [
          "a[slot='title']",
          "a[data-testid='post-title']",
          "a.title",
          "a[href*='/comments/']",
        ],
        author: [
          "a[href^='/user/']",
          "a[data-testid='post_author_link']",
          "a.author",
          "span[slot='authorName']",
        ],
        authorUrl: [
          "a[href^='/user/']",
          "a[data-testid='post_author_link']",
          "a.author",
        ],
        subreddit: [
          "a[href^='/r/']",
          "span[data-testid='subreddit-name']",
          "a.subreddit",
        ],
        publishedAt: [
          "faceplate-timeago time",
          "faceplate-timeago",
          "time[datetime]",
          "time",
          "span.live-timestamp",
        ],
      };
    }

    getMediaType(element) {
      if (element.querySelector("shreddit-player") || element.querySelector("video")) {
        return "video";
      }
      if (element.querySelector("img[alt='Post image']") || element.querySelector("gallery-carousel")) {
        return "image";
      }
      return "post";
    }

    extractFromElement(element) {
      const selectors = this.getSelectors();

      // Extract URL
      let url = DomUtils.getHref(element, selectors.url);
      if (!url && element.tagName && element.tagName.toLowerCase() === "shreddit-post") {
        url = element.getAttribute("permalink") || "";
      }

      if (!url) return null;
      url = ExtractorUtils.toAbsoluteUrl(url);

      if (!url.includes("/comments/")) {
        return null;
      }

      // Extract Title / Caption
      let caption = DomUtils.getTextContent(element, selectors.title);
      if (!caption && element.getAttribute("post-title")) {
        caption = element.getAttribute("post-title");
      }
      caption = caption.trim();
      if (!caption) return null;

      // Extract Author
      let author = DomUtils.getTextContent(element, selectors.author);
      if (!author && element.getAttribute("author")) {
        author = `u/${element.getAttribute("author")}`;
      }

      let authorUrl = DomUtils.getHref(element, selectors.authorUrl);
      if (authorUrl) authorUrl = ExtractorUtils.toAbsoluteUrl(authorUrl);

      // Extract Subreddit / Community
      let subreddit = DomUtils.getTextContent(element, selectors.subreddit);
      if (!subreddit && element.getAttribute("subreddit-prefixed-name")) {
        subreddit = element.getAttribute("subreddit-prefixed-name");
      }

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
        caption: subreddit ? `[${subreddit}] ${caption}` : caption,
        url,
        normalizedUrl: url,
        author: author || subreddit || "reddit_user",
        authorUrl,
        publishedAt,
        mediaType,
        hashtags,
        keywords,
      };
    }
  }

  // Register and initialize adapter
  NS.initAdapter(new RedditAdapter());
})();
