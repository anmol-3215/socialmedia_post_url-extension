# Social Media Research Extraction Toolkit — Project Build Guide

**Purpose:** Chrome MV3 extension that collects publicly accessible social-media
post/video URLs and metadata (YouTube, Instagram, X/Twitter, Facebook, Reddit)
for a financial-fraud/scam research dataset (India-focused, extensible to
other regions). Output feeds a future AI/ML classification pipeline.

**Status:** Phases 1–5 are already built (architecture, manifest, dashboard UI).
Continue from Phase 6. Do not re-architect what's already decided below —
treat this file as the source of truth and implement against it directly.

---

## 0. Hard Constraints (never violate)

- Only collect **publicly accessible** content, reached through normal
  user-initiated browser navigation.
- Never: bypass CAPTCHA, bypass authentication/paywalls, defeat anti-bot
  systems, steal cookies/session tokens, access private accounts/posts,
  circumvent rate limits, spoof identity, use stolen credentials, or ignore
  documented access restrictions.
- If a platform cannot be reliably/permissibly automated, mark it
  `LIMITED_BY_PLATFORM` or `NOT_SUPPORTED` in `platformCapabilities` and say
  so in the UI — never fake functionality.
- Never fabricate selectors, endpoints, or platform behavior. If uncertain
  about current platform DOM/URL structure, implement a diagnostic fallback
  (`selector-health-check`) instead of guessing silently.
- No `eval()`, no remote code execution, no `innerHTML` with scraped content
  (use `textContent`), no credential/cookie storage, no external network
  calls with collected data unless explicitly configured/consented.
- Priority order when tradeoffs arise: **Correctness > Legal/Platform
  Compliance > Reliability > Data Quality > Security > Performance > UI
  Polish.**

---

## 1. Architecture (already implemented)

```
Dashboard (side panel)
   → chrome.runtime.sendMessage(START_EXTRACTION)
        → Service Worker: validates config, targets active tab,
          chrome.scripting.executeScript(adapter) [activeTab-scoped, on demand]
             → Content script (platform adapter): search()/extract()/getNextPage()
                → batched RESULT_BATCH messages → Service Worker
                   → dedupe + normalize + persist (IndexedDB)
                      → EXTRACTION_PROGRESS / RESULT_BATCH → Dashboard
        ← STOP_EXTRACTION → state machine → STOPPING → IDLE
```

**Decisions already locked in:**
- **Side Panel, not popup** (`chrome.sidePanel`) — the dashboard must survive
  the user switching focus to the platform tab mid-extraction.
- **No `host_permissions`, no static `content_scripts`.** Adapters are
  injected on demand via `activeTab` + `chrome.scripting.executeScript`,
  triggered only by the user pressing Start. This is the deliberate,
  minimum-permission tradeoff — do not add broad host matches without a
  documented reason.
- **Dashboard never talks to content scripts directly.** All communication
  routes through the service worker so state has a single source of truth
  and survives worker suspension.
- Every platform gets its own adapter behind a shared `BaseAdapter` interface:
  `search()`, `extract()`, `normalize()`, `deduplicate()`, `getNextPage()`, `stop()`.
- Settings → `chrome.storage.local`. Result records (can reach thousands) →
  IndexedDB via `src/storage/indexed-db.js`.

---

## 2. Project Structure (already scaffolded)

```
social-media-research-extension/
├── manifest.json                     ✅ built
├── README.md                         ✅ built
├── package.json                      ⬜ add if dev tooling (eslint/vitest) is used
│
├── src/
│   ├── background/
│   │   ├── service-worker.js         ⬜ Phase 6
│   │   ├── message-router.js         ⬜ Phase 6
│   │   ├── extraction-manager.js     ⬜ Phase 6
│   │   └── state-manager.js          ⬜ Phase 6
│   │
│   ├── dashboard/
│   │   ├── dashboard.html            ✅ built
│   │   ├── dashboard.css             ✅ built
│   │   └── dashboard.js              ✅ built (demo mode works standalone;
│   │                                     replace local MSG map with
│   │                                     src/shared/messages.js import once
│   │                                     Phase 6 lands)
│   │
│   ├── content/
│   │   ├── core/
│   │   │   ├── base-adapter.js       ⬜ Phase 7
│   │   │   ├── dom-utils.js          ⬜ Phase 7/8
│   │   │   ├── scroll-manager.js     ⬜ Phase 8
│   │   │   ├── url-utils.js          ⬜ Phase 6 (normalizeUrl, isValidSocialUrl)
│   │   │   └── extractor-utils.js    ⬜ Phase 7/8
│   │   ├── youtube/youtube-adapter.js     ⬜ Phase 7
│   │   ├── instagram/instagram-adapter.js ⬜ Phase 7
│   │   ├── x/x-adapter.js                 ⬜ Phase 7
│   │   ├── facebook/facebook-adapter.js   ⬜ Phase 7 (disabled by default)
│   │   └── reddit/reddit-adapter.js       ⬜ Phase 7
│   │
│   ├── storage/
│   │   ├── storage-manager.js        ⬜ Phase 6 (settings, chrome.storage.local)
│   │   └── indexed-db.js             ⬜ Phase 6 (result records)
│   │
│   ├── export/
│   │   ├── csv-exporter.js           ⬜ Phase 9
│   │   └── xlsx-exporter.js          ⬜ Phase 9 (bundle library locally, no remote CDN)
│   │
│   ├── shared/
│   │   ├── constants.js              ⬜ Phase 6 (platform list, limits, regions, message types)
│   │   ├── messages.js               ⬜ Phase 6 (message factory + schema)
│   │   ├── logger.js                 ⬜ Phase 6 (DEBUG/INFO/WARN/ERROR)
│   │   └── schemas.js                ⬜ Phase 6 (normalized record schema, capability map)
│   │
│   └── assets/icons/                 ⬜ add 16/32/48/128px PNGs before packaging
│
└── tests/
    ├── unit/                         ⬜ Phase 10
    └── integration/                  ⬜ Phase 10
```

---

## 3. Manifest (already built — do not change permissions without reason)

`manifest.json` uses MV3, `side_panel.default_path` = `src/dashboard/dashboard.html`,
background service worker at `src/background/service-worker.js` (type `module`),
and permissions: `storage`, `scripting`, `activeTab`, `downloads`, `sidePanel`,
`tabs`. No `host_permissions`. Add icons before Chrome Web Store packaging (Phase 12).

`service-worker.js` (Phase 6) must call:
```js
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
```
so clicking the toolbar icon opens the panel.

---

## 4. Data Model (normalized record schema)

```js
{
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
  collectedAt: "",
  mediaType: "",
  extractionSource: "",
  region: "",
  status: "",   // valid | error
  error: "",
  // reserved for future AI dataset use — do not populate in V1:
  fraud_category: null,
  fraud_probability: null,
  language: null,
  sentiment: null,
  risk_score: null,
  human_label: null,
  review_status: null,
  label_source: null,
}
```

Table columns (dashboard, already built): `#`, Caption, URL, Keywords/Hashtags,
Platform, Author, Date, Status.

---

## 5. Message Types (define in `src/shared/constants.js`)

```
START_EXTRACTION, STOP_EXTRACTION, PAUSE_EXTRACTION, RESUME_EXTRACTION
EXTRACTION_STARTED, RESULT_FOUND, RESULT_BATCH, EXTRACTION_PROGRESS,
EXTRACTION_COMPLETED, EXTRACTION_ERROR
GET_SETTINGS, SAVE_SETTINGS
EXPORT_CSV, EXPORT_XLSX
```
Schema: `{ type: "RESULT_BATCH", payload: { results: [...] } }`.
`dashboard.js` already implements listeners for the inbound types — Phase 6
just needs to emit them from the service worker in this exact shape.

PAUSE/RESUME: implement STOP first (already wired in dashboard). Architect
`extraction-manager.js` so PAUSE/RESUME can be added later without a rewrite
(i.e., keep the state machine below, don't hardcode a binary running/stopped flag).

---

## 6. State Machine

```
IDLE → INITIALIZING → SEARCHING → EXTRACTING → SCROLLING → EXTRACTING →
PROCESSING → COMPLETED
```
STOP must transition `* → STOPPING → IDLE` cleanly with no orphaned loops
(scroll timers, MutationObservers, and `setTimeout` chains must all check a
`shouldStop` flag before continuing).

---

## 7. URL Normalization & Validation (`src/content/core/url-utils.js`)

- `normalizeUrl(url, platform)` — strip tracking/unnecessary query params,
  normalize trailing slashes and mobile/desktop host variants; **never**
  strip params required to uniquely identify the resource (e.g. YouTube `v=`).
- `isValidSocialUrl(url, platform)` — reject URLs not belonging to the
  selected platform's known domains (youtube.com/youtu.be, instagram.com,
  x.com/twitter.com, facebook.com, reddit.com).

## 8. Deduplication

Identity hierarchy: platform-native post/video ID → canonical URL → fallback
normalized URL. `deduplicateResults(results)` in the extraction manager.
Dashboard already tracks/display Discovered/Valid/Duplicates/Errors — keep
those counters wired to real dedup output in Phase 6/8.

## 9. Extraction Limits

Stop at N **unique valid** records, not N DOM elements inspected. `Unlimited`
uses the dashboard's indeterminate progress bar (already implemented).

---

## 10. Platform Adapters (Phase 7)

Common interface (`base-adapter.js`): `search()`, `extract()`, `normalize()`,
`deduplicate()`, `getNextPage()`, `stop()`.

| Platform | Target scope | Notes |
|---|---|---|
| YouTube | Public search results, videos/Shorts | Distinguish video/short/channel/playlist; only collect requested type |
| Instagram | Hashtag pages, search results, public posts/Reels | If reliable extraction isn't possible, report `"Instagram extraction is currently limited by platform access restrictions."` — don't fake it |
| X/Twitter | Public search/result pages | Handle both `x.com` and `twitter.com` |
| Facebook | Public post/video/page (not profile) | Ship `enabled: false` in `platformCapabilities` if extraction can't be done reliably within the hard constraints; expose the limitation in UI |
| Reddit | Public search pages | Handle dynamic loading/pagination |

`platformCapabilities` map (already reflected in `dashboard.js`):
```js
{
  youtube: { enabled: true },
  instagram: { enabled: true, mode: "public-browser-context" },
  x: { enabled: true },
  facebook: { enabled: false, reason: "platform limitations" },
  reddit: { enabled: true },
}
```

Search URL builders: `buildSearchUrl(platform, keyword, region)` — only use
publicly documented/observed URL patterns; if none exists reliably, explain
the limitation instead of inventing syntax.

Region handling: `buildSearchQuery(keyword, region, platform)` treats region
as a **query modifier only** (e.g. for India: `India`, `Indian`, `INR`, `UPI`,
`RBI`, `SEBI`), never as verified geographic origin. UI already labels each
region as Supported / Partially supported / Not supported.

Centralize selectors (never scatter `document.querySelector(".abc123")` inline):
```js
const selectors = { result: [...], caption: [...], url: [...] };
```
Provide fallback selectors and a diagnostic report when zero results are found
(expected vs. detected count + likely cause), never a silent empty return.

---

## 11. Dynamic Extraction (Phase 8)

Infinite-scroll loop, using `MutationObserver` + controlled scrolling:
```
Extract visible → check count → scroll → wait → DOM changes →
extract new → deduplicate → repeat
```
Config knobs with safe defaults: `scrollDelay`, `mutationDebounce`,
`batchSize`, `maxScrollAttempts`, `stagnationThreshold`. No `while(true)`
scroll loops, no thousands of DOM queries per second. Batch `RESULT_BATCH`
messages (e.g. groups of 10), never one message per record.

---

## 12. Export (Phase 9)

- CSV: correct comma/quote/newline escaping, UTF-8 with BOM (dashboard.js's
  inline CSV exporter already does this for demo mode — extract that logic
  into `src/export/csv-exporter.js` and reuse).
- XLSX: columns `#, Platform, Caption, URL, Keywords/Hashtags, Author, Date,
  Collected At`. Bundle the XLSX library locally in the extension — no
  remote CDN loading (MV3 CSP compliance).
- Route real exports through the service worker (`EXPORT_CSV`/`EXPORT_XLSX`)
  once IndexedDB holds the full result set, so exports aren't capped to
  whatever's currently rendered in the dashboard's in-memory `state.results`.

---

## 13. Storage (Phase 6)

`storage-manager.js`: `saveSettings()`, `loadSettings()`, `saveResult()`,
`saveResults()`, `getResults()`, `clearResults()`, `getExtractionState()`,
`saveExtractionState()`. Must persist extraction state so it survives service
worker suspension/restart — do not rely on in-memory globals as sole state.

---

## 14. Logging

Levels: `DEBUG, INFO, WARN, ERROR`. Dashboard already has a `View Logs`
drawer wired to a local `log()` function — route service-worker/content-script
logs into the same drawer via a `LOG_ENTRY` message type once Phase 6 lands.
Never surface raw stack traces to the user; keep those in the debug log only.

---

## 15. Security Checklist (apply throughout)

- No `eval()`, no remote script execution.
- Use `textContent`, never `innerHTML`, when inserting scraped content
  (dashboard.js already follows this).
- No credentials, cookies, or session tokens stored or transmitted.
- No PII enrichment of scraped captions/comments.
- No data sent to any external server without explicit configuration/consent.

---

## 16. Testing Plan (Phase 10)

- **Unit:** URL normalization, URL validation, hashtag/keyword extraction,
  deduplication, CSV generation, record normalization.
- **Integration:** Dashboard↔Service Worker, Service Worker↔Content Script,
  Storage↔Dashboard, Export↔File.
- **Manual per-platform checklist:** search page loads → initial results
  detected → dynamic results detected on scroll → duplicate detection works
  → limit respected → STOP works cleanly → export works.

---

## 17. Build & Debug Reference

- Load: `chrome://extensions` → Developer mode → **Load unpacked** → project folder.
- Reload after JS changes: refresh icon on the extension card; also reload
  the target platform tab for content-script changes.
- Service worker logs: extension card → **service worker** link.
- Content script logs: DevTools (F12) on the platform tab itself.
- Dashboard logs: right-click the open side panel → **Inspect**.
- Package: `chrome://extensions` → **Pack extension** (produces `.crx`/`.pem`);
  Chrome Web Store submission instead needs a `.zip` of the folder plus
  privacy-practice disclosures for the permissions above before publishing.
- Common failure points to check: manifest JSON validity, permission
  mismatches (unused permissions declared / used-but-undeclared), content
  script not injected (activeTab requires a fresh user gesture per session),
  service worker not waking (check `type: "module"` and file path), CSP
  violations (no inline scripts/remote code), message-passing races (always
  check `chrome.runtime.lastError`).

---

## 18. Remaining Build Order

1. **Phase 6** — `src/shared/{constants,messages,logger,schemas}.js`,
   `src/storage/{storage-manager,indexed-db}.js`,
   `src/background/{service-worker,message-router,extraction-manager,state-manager}.js`,
   `src/content/core/url-utils.js`.
2. **Phase 7** — `src/content/core/base-adapter.js` + all five platform adapters.
3. **Phase 8** — `src/content/core/{scroll-manager,dom-utils,extractor-utils}.js`
   (MutationObserver-driven incremental extraction wired into the adapters).
4. **Phase 9** — `src/export/{csv-exporter,xlsx-exporter}.js`, wired to the
   dashboard's Export buttons via the service worker.
5. **Phase 10** — `tests/unit/*`, `tests/integration/*`, manual test checklist run.
6. **Phase 11** — troubleshooting guide expansion based on what actually broke during 6–9.
7. **Phase 12** — icons, `package.json` finalization, Chrome Web Store packaging steps.

Build strictly in this order — later phases depend on the message/schema
contracts and storage layer defined in Phase 6.
