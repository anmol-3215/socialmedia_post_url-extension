# Social Media Research Extraction Toolkit

Chrome MV3 extension for collecting publicly accessible social-media post/video
URLs and metadata for financial-fraud research dataset-building. See project
brief for full requirements.

## Status: Phases 1–5 complete

- [x] Phase 1 — Architecture (see conversation / design notes)
- [x] Phase 2 — Project setup instructions
- [x] Phase 3 — Project structure
- [x] Phase 4 — `manifest.json`
- [x] Phase 5 — Dashboard (`src/dashboard/`)
- [ ] Phase 6 — Core engine (service worker, extraction manager, storage manager, normalizer, dedup, logger, state machine)
- [ ] Phase 7 — Platform adapters (YouTube, Instagram, X, Facebook, Reddit)
- [ ] Phase 8 — Dynamic extraction (MutationObserver, scroll manager, stagnation detection)
- [ ] Phase 9 — Export (CSV/XLSX exporter modules)
- [ ] Phase 10 — Testing
- [ ] Phase 11 — Debugging guide
- [ ] Phase 12 — Build & deploy

## Try it now (demo mode)

The dashboard is already fully interactive without any backend:

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Click the extension's toolbar icon to open the side panel.
3. "Demo Mode" is on by default. Pick a platform, type a keyword, press
   **Start Extraction** — mock records will stream into the table so you can
   test filtering, dedup counters, and **Export CSV**.
4. Turn Demo Mode off once Phase 6/7 background + adapters are added — Start
   will then attempt real extraction on the active tab.

## Platform capability status (V1 target)

| Platform | Status |
|---|---|
| YouTube | Supported |
| Instagram | Partially supported — public browser context only |
| X / Twitter | Supported |
| Facebook | Disabled — `platform limitations`, exposed in UI, not hidden |
| Reddit | Supported |

Region filtering is a search-query modifier or post-hoc label only — never
treated as verified geographic origin.
# socialmedia_post_url-extension
