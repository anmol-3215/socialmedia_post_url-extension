/**
 * url-utils.js — URL normalization, validation, and platform ID extraction.
 *
 * Designed to be used in both service-worker and content-script contexts.
 * Content scripts import this file when the adapter is injected.
 */

import { PLATFORMS, PLATFORM_DOMAINS } from "../../shared/constants.js";

// ─── URL Normalization ───────────────────────────────────────────────────────

/**
 * Parameters that are safe to strip per platform.
 * NEVER strip parameters required to identify the resource (e.g., YouTube v=).
 */
const STRIP_PARAMS = {
  // Common tracking params stripped from all platforms
  _common: [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "si", "feature", "ref", "ref_src", "ref_url", "fbclid", "gclid",
    "igshid", "igsh", "s", "t", "context",
  ],
  [PLATFORMS.YOUTUBE]: [
    "si", "feature", "app", "ab_channel", "pp", "themeRefresh",
    "list",  // playlist param — strip only from individual video URLs
  ],
  [PLATFORMS.INSTAGRAM]: ["igshid", "igsh", "img_index", "hl"],
  [PLATFORMS.X]: ["s", "t", "ref_src", "ref_url", "src"],
  [PLATFORMS.FACEBOOK]: ["mibextid", "paipv", "eav", "ref", "__tn__", "__cft__[0]"],
  [PLATFORMS.REDDIT]: ["share_id", "utm_source", "utm_medium", "context", "ref", "ref_source"],
};

/**
 * Normalize a URL for a given platform.
 *
 * - Strips tracking/unnecessary query parameters
 * - Normalizes host (www/mobile → canonical)
 * - Removes trailing slashes
 * - Preserves resource-identifying params (e.g., YouTube `v=`)
 *
 * @param {string} rawUrl
 * @param {string} platform
 * @returns {string} Normalized URL
 */
export function normalizeUrl(rawUrl, platform) {
  if (!rawUrl) return "";

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }

  // Protocol normalization
  if (url.protocol === "http:") url.protocol = "https:";

  // Host normalization per platform
  url.hostname = normalizeHost(url.hostname, platform);

  // YouTube short URL expansion
  if (platform === PLATFORMS.YOUTUBE && url.hostname === "youtu.be") {
    const videoId = url.pathname.slice(1).split("/")[0];
    if (videoId) {
      url = new URL(`https://www.youtube.com/watch?v=${videoId}`);
    }
  }

  // Strip tracking parameters
  const toStrip = [
    ...(STRIP_PARAMS._common || []),
    ...(STRIP_PARAMS[platform] || []),
  ];

  for (const param of toStrip) {
    url.searchParams.delete(param);
  }

  // YouTube-specific: keep `v=` but sort remaining params for consistency
  if (platform === PLATFORMS.YOUTUBE) {
    const v = url.searchParams.get("v");
    if (v && url.pathname === "/watch") {
      // Keep only `v=` for video URLs
      const newUrl = new URL(`https://www.youtube.com/watch?v=${v}`);
      return newUrl.toString();
    }
  }

  // Remove trailing slash (unless it's just the root path)
  let result = url.toString();
  if (result.endsWith("/") && url.pathname !== "/") {
    result = result.slice(0, -1);
  }

  // Remove empty hash
  if (result.endsWith("#")) {
    result = result.slice(0, -1);
  }

  return result;
}

/**
 * Normalize hostname to canonical form.
 * @param {string} hostname
 * @param {string} platform
 * @returns {string}
 */
function normalizeHost(hostname, platform) {
  const lower = hostname.toLowerCase();
  switch (platform) {
    case PLATFORMS.YOUTUBE:
      if (lower === "m.youtube.com" || lower === "youtube.com") return "www.youtube.com";
      return lower;
    case PLATFORMS.INSTAGRAM:
      if (lower === "instagram.com") return "www.instagram.com";
      return lower;
    case PLATFORMS.X:
      // Normalize twitter.com variants to x.com
      if (lower === "twitter.com" || lower === "www.twitter.com" || lower === "mobile.twitter.com") return "x.com";
      if (lower === "www.x.com" || lower === "mobile.x.com") return "x.com";
      return lower;
    case PLATFORMS.FACEBOOK:
      if (lower === "m.facebook.com" || lower === "web.facebook.com" || lower === "facebook.com") return "www.facebook.com";
      return lower;
    case PLATFORMS.REDDIT:
      if (lower === "old.reddit.com" || lower === "new.reddit.com" || lower === "reddit.com") return "www.reddit.com";
      return lower;
    default:
      return lower;
  }
}

// ─── URL Validation ──────────────────────────────────────────────────────────

/**
 * Check whether a URL belongs to the specified platform.
 * @param {string} rawUrl
 * @param {string} platform
 * @returns {boolean}
 */
export function isValidSocialUrl(rawUrl, platform) {
  if (!rawUrl || !platform) return false;

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const domains = PLATFORM_DOMAINS[platform];
  if (!domains) return false;

  const hostname = url.hostname.toLowerCase();
  return domains.some((d) => hostname === d || hostname.endsWith("." + d));
}

/**
 * Check if a URL looks like an actual post/video rather than a general page.
 * @param {string} rawUrl
 * @param {string} platform
 * @returns {boolean}
 */
export function isContentUrl(rawUrl, platform) {
  if (!isValidSocialUrl(rawUrl, platform)) return false;

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  const path = url.pathname;

  switch (platform) {
    case PLATFORMS.YOUTUBE:
      // video: /watch?v=xxx or /shorts/xxx
      return (path === "/watch" && url.searchParams.has("v"))
        || path.startsWith("/shorts/");
    case PLATFORMS.INSTAGRAM:
      // post: /p/xxx/ or /reel/xxx/
      return path.startsWith("/p/") || path.startsWith("/reel/");
    case PLATFORMS.X:
      // tweet: /<user>/status/<id>
      return /^\/[^/]+\/status\/\d+/.test(path);
    case PLATFORMS.FACEBOOK:
      // various post patterns
      return path.includes("/posts/")
        || path.includes("/videos/")
        || path.includes("/watch/")
        || path.includes("/reel/")
        || /\/\d+$/.test(path);
    case PLATFORMS.REDDIT:
      // post: /r/<sub>/comments/<id>/
      return path.includes("/comments/");
    default:
      return true;
  }
}

// ─── Platform ID Extraction ──────────────────────────────────────────────────

/**
 * Extract the platform-native content ID from a URL.
 * Used as the primary deduplication key.
 * @param {string} rawUrl
 * @param {string} platform
 * @returns {string|null} The ID or null if not extractable.
 */
export function extractPlatformId(rawUrl, platform) {
  if (!rawUrl) return null;

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  switch (platform) {
    case PLATFORMS.YOUTUBE: {
      // Standard video: /watch?v=XXXXXXXXXXX
      const v = url.searchParams.get("v");
      if (v) return `yt-${v}`;
      // Shorts: /shorts/XXXXXXXXXXX
      const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch) return `yt-${shortsMatch[1]}`;
      // youtu.be/XXXXXXXXXXX
      if (url.hostname === "youtu.be") {
        const id = url.pathname.slice(1).split("/")[0];
        if (id) return `yt-${id}`;
      }
      return null;
    }

    case PLATFORMS.INSTAGRAM: {
      // /p/SHORTCODE/ or /reel/SHORTCODE/
      const igMatch = url.pathname.match(/\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
      return igMatch ? `ig-${igMatch[1]}` : null;
    }

    case PLATFORMS.X: {
      // /<user>/status/<id>
      const xMatch = url.pathname.match(/\/[^/]+\/status\/(\d+)/);
      return xMatch ? `x-${xMatch[1]}` : null;
    }

    case PLATFORMS.FACEBOOK: {
      // Various patterns — attempt to find a numeric ID
      const fbMatch = url.pathname.match(/\/(?:posts|videos|watch|reel)\/(\d+)/)
        || url.pathname.match(/\/(\d{10,})$/);
      return fbMatch ? `fb-${fbMatch[1]}` : null;
    }

    case PLATFORMS.REDDIT: {
      // /r/<sub>/comments/<id>/
      const rdMatch = url.pathname.match(/\/comments\/([a-z0-9]+)/i);
      return rdMatch ? `rd-${rdMatch[1]}` : null;
    }

    default:
      return null;
  }
}

// ─── Search URL Builders ─────────────────────────────────────────────────────

/**
 * Build a platform-specific search URL.
 * Uses only publicly documented/observed URL patterns.
 *
 * @param {string} platform
 * @param {string} keyword
 * @param {string} [region=""]
 * @returns {{ url: string|null, supported: boolean, note: string }}
 */
export function buildSearchUrl(platform, keyword, region = "") {
  const query = buildSearchQuery(keyword, region, platform);

  switch (platform) {
    case PLATFORMS.YOUTUBE:
      return {
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        supported: true,
        note: "YouTube public search",
      };

    case PLATFORMS.INSTAGRAM:
      // Instagram hashtag pages: /explore/tags/<tag>/
      // If keyword starts with #, strip it for the URL
      {
        const tag = keyword.replace(/^#/, "").trim();
        if (tag) {
          return {
            url: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`,
            supported: true,
            note: "Instagram public hashtag page. Region modifier not applicable — Instagram does not support geographic search filters.",
          };
        }
        return {
          url: null,
          supported: false,
          note: "Instagram search requires a hashtag (e.g. #financialscam). Free-text search is not publicly accessible without login.",
        };
      }

    case PLATFORMS.X:
      return {
        url: `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`,
        supported: true,
        note: "X/Twitter public search. Note: X may require login for some searches; extraction operates on whatever is visible in the user's browser.",
      };

    case PLATFORMS.FACEBOOK:
      return {
        url: null,
        supported: false,
        note: "Facebook search extraction is disabled in V1 due to platform access restrictions that cannot be bypassed within the extension's design constraints.",
      };

    case PLATFORMS.REDDIT:
      return {
        url: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&type=link`,
        supported: true,
        note: "Reddit public search",
      };

    default:
      return { url: null, supported: false, note: `Unknown platform: ${platform}` };
  }
}

/**
 * Build a search query string with optional region modifier.
 * Region is treated as a query modifier only — never verified origin.
 *
 * @param {string} keyword
 * @param {string} region
 * @param {string} platform
 * @returns {string}
 */
export function buildSearchQuery(keyword, region, platform) {
  let query = keyword.trim();

  // Instagram hashtag pages don't support query modifiers
  if (platform === PLATFORMS.INSTAGRAM) return query;

  // For region=global or no region, skip modifier
  if (!region || region === "global") return query;

  // Import region info (avoid circular dependency — inline the check)
  const regionModifiers = {
    india: "India",
    asia: "Asia",
    usa: "USA",
    uk: "UK",
    europe: "",       // no reliable modifier
    middle_east: "",  // no reliable modifier
  };

  const modifier = regionModifiers[region];
  if (modifier) {
    query = `${query} ${modifier}`;
  }

  return query;
}
