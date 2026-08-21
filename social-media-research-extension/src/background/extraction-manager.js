/**
 * extraction-manager.js — Multi-platform concurrent extraction orchestrator.
 *
 * Coordinates simultaneous extraction across multiple social media platforms (YouTube, X,
 * Instagram, Reddit, Facebook). Manages concurrent tabs, per-platform worker state,
 * error isolation, deduplication, NVIDIA AI fraud classification, and persistence.
 */

import {
  MSG,
  EXTRACTION_STATES,
  WORKER_STATUS,
  PLATFORMS,
  PLATFORM_CAPABILITIES,
  EXTRACTION_DEFAULTS,
} from "../shared/constants.js";
import { createLogger } from "../shared/logger.js";
import { normalizeRecord, validateRecord } from "../shared/schemas.js";
import {
  normalizeUrl,
  extractPlatformId,
  buildSearchUrl,
  isValidSocialUrl,
} from "../content/core/url-utils.js";
import { saveResults, getExistingIds, clearResults } from "../storage/indexed-db.js";
import { stateMachine } from "./state-manager.js";
import { broadcastToDashboard } from "./message-router.js";
import { analyzePostWithAI } from "../ai/nvidia-ai.js";

const logger = createLogger("extraction-manager");

/** @type {Map<number, string>} tabId -> platform */
const _tabPlatformMap = new Map();

/** @type {Map<string, { tabId: number|null, status: string, count: number }>} */
const _platformWorkers = new Map();

/** @type {Set<string>} Deduplication cache (platform:id and canonical URLs) */
let _knownIds = new Set();

/** @type {number|null} */
let _timeoutTimer = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start a unified multi-platform extraction job.
 * @param {object} config - { platforms: string[], keywords: string[], limit: number|string, region: string, enableAi: boolean }
 */
export async function startExtraction(config) {
  if (stateMachine.isRunning) {
    logger.warn("Extraction already in progress — ignoring start request");
    return;
  }

  const platforms = Array.isArray(config.platforms) && config.platforms.length > 0
    ? config.platforms
    : [config.platform || PLATFORMS.YOUTUBE];

  logger.info(`Starting unified extraction across ${platforms.length} platforms: ${platforms.join(", ")}`);

  // Clean state
  _tabPlatformMap.clear();
  _platformWorkers.clear();

  // Load existing IDs for cross-session deduplication
  try {
    _knownIds = await getExistingIds();
    logger.info(`Loaded ${_knownIds.size} existing IDs for deduplication`);
  } catch {
    _knownIds = new Set();
  }

  // Start global state machine
  stateMachine.start({ ...config, platforms });

  broadcastToDashboard({
    type: MSG.EXTRACTION_STARTED,
    payload: { platforms, keywords: config.keywords, limit: config.limit, region: config.region },
  });

  // Set global watchdog timeout (10 minutes)
  _timeoutTimer = setTimeout(() => {
    logger.warn("Global extraction timeout reached");
    stopExtraction("Extraction timed out after 10 minutes");
  }, EXTRACTION_DEFAULTS.extractionTimeout * 2);

  stateMachine.transition(EXTRACTION_STATES.EXTRACTING);

  // Launch workers in parallel with independent error isolation
  const workerPromises = platforms.map((platform) => launchPlatformWorker(platform, config));
  await Promise.allSettled(workerPromises);
}

/**
 * Launch an independent worker tab for a specific platform.
 */
async function launchPlatformWorker(platform, config) {
  const capabilities = PLATFORM_CAPABILITIES[platform];

  if (!capabilities || !capabilities.enabled) {
    const reason = capabilities?.reason || "Platform extraction is disabled";
    logger.warn(`Skipping ${platform}: ${reason}`);
    stateMachine.setPlatformStatus(platform, WORKER_STATUS.DISABLED, { error: reason });
    broadcastToDashboard({
      type: MSG.PLATFORM_STATUS_UPDATE,
      payload: { platform, status: WORKER_STATUS.DISABLED, error: reason },
    });
    return;
  }

  _platformWorkers.set(platform, { tabId: null, status: WORKER_STATUS.RUNNING, count: 0 });
  stateMachine.setPlatformStatus(platform, WORKER_STATUS.RUNNING);

  const keyword = config.keywords[0] || "";
  const searchResult = buildSearchUrl(platform, keyword, config.region);

  if (!searchResult.supported || !searchResult.url) {
    const errorMsg = searchResult.note || "Unsupported search configuration";
    logger.warn(`Search URL failed for ${platform}: ${errorMsg}`);
    _platformWorkers.set(platform, { tabId: null, status: WORKER_STATUS.ERROR, count: 0 });
    stateMachine.setPlatformStatus(platform, WORKER_STATUS.ERROR, { error: errorMsg });
    broadcastToDashboard({
      type: MSG.PLATFORM_STATUS_UPDATE,
      payload: { platform, status: WORKER_STATUS.ERROR, error: errorMsg },
    });
    return;
  }

  try {
    logger.info(`Opening tab for ${platform}: ${searchResult.url}`);
    const tab = await chrome.tabs.create({ url: searchResult.url, active: false });
    const tabId = tab.id;

    _tabPlatformMap.set(tabId, platform);
    _platformWorkers.get(platform).tabId = tabId;

    // Wait for page load
    await waitForTabLoad(tabId);
    logger.info(`Tab ${tabId} ready. Injecting adapter for ${platform}`);

    // Inject scripts
    await injectAdapter(tabId, platform, config);

    broadcastToDashboard({
      type: MSG.PLATFORM_STATUS_UPDATE,
      payload: { platform, status: WORKER_STATUS.RUNNING, tabId },
    });

  } catch (err) {
    logger.error(`Worker error for ${platform}: ${err.message}`);
    stateMachine.setPlatformStatus(platform, WORKER_STATUS.ERROR, { error: err.message });
    broadcastToDashboard({
      type: MSG.PLATFORM_STATUS_UPDATE,
      payload: { platform, status: WORKER_STATUS.ERROR, error: err.message },
    });
  }
}

/**
 * Stop all active platform extraction workers.
 */
export async function stopExtraction(reason = "User requested stop") {
  logger.info(`Stopping all platform workers: ${reason}`);
  stateMachine.stop();

  // Broadcast stop to all active tabs
  for (const [tabId, platform] of _tabPlatformMap.entries()) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: MSG.CS_STOP });
    } catch {
      // Tab may be closed
    }
  }

  broadcastToDashboard({
    type: MSG.EXTRACTION_COMPLETED,
    payload: stateMachine.stats,
  });

  cleanup();
  stateMachine.reset();
}

/**
 * Pause extraction across all workers.
 */
export async function pauseExtraction() {
  stateMachine.pause();
  for (const [tabId] of _tabPlatformMap.entries()) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: MSG.CS_STOP });
    } catch {
      // ignore
    }
  }
}

/**
 * Resume extraction.
 */
export async function resumeExtraction() {
  stateMachine.resume();
  for (const [tabId, platform] of _tabPlatformMap.entries()) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: MSG.CS_EXTRACT });
    } catch {
      // ignore
    }
  }
}

// ─── Result Processing & AI Pipeline ─────────────────────────────────────────

/**
 * Process incoming batch of results from any platform content script.
 * @param {object[]} rawResults
 * @param {number} tabId
 */
export async function processResultBatch(rawResults, tabId) {
  if (!rawResults || rawResults.length === 0) return;
  if (stateMachine.shouldStop) return;

  const platform = _tabPlatformMap.get(tabId) || rawResults[0]?.platform || "unknown";
  const config = stateMachine.config;
  const limit = config?.limit;
  const enableAi = config?.enableAi !== false;

  let added = 0;
  let duplicates = 0;
  let errors = 0;
  let aiFlagged = 0;
  const newRecords = [];

  for (const raw of rawResults) {
    const record = normalizeRecord({
      ...raw,
      platform,
      region: config?.region || "",
      extractionSource: "content-script",
      normalizedUrl: normalizeUrl(raw.url, platform),
    });

    if (!record.id) {
      record.id = extractPlatformId(record.url, platform) || `${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    const validation = validateRecord(record);
    if (!validation.valid) {
      errors++;
      continue;
    }

    if (!isValidSocialUrl(record.url, platform)) {
      errors++;
      continue;
    }

    // Deduplication check
    const dedupIdKey = `${platform}:${record.id}`;
    const dedupUrlKey = `url:${record.normalizedUrl}`;
    if (_knownIds.has(dedupIdKey) || _knownIds.has(dedupUrlKey)) {
      duplicates++;
      continue;
    }

    _knownIds.add(dedupIdKey);
    _knownIds.add(dedupUrlKey);

    // NVIDIA AI analysis (if enabled)
    if (enableAi && record.caption) {
      try {
        const aiResult = await analyzePostWithAI(record.caption, platform);
        record.fraud_category = aiResult.fraud_category;
        record.risk_score = aiResult.risk_score;
        record.language = aiResult.language;
        record.ai_summary = aiResult.ai_summary;
        if (aiResult.is_scam || (aiResult.risk_score && aiResult.risk_score >= 60)) {
          aiFlagged++;
        }
      } catch (err) {
        logger.debug(`AI analysis error: ${err.message}`);
      }
    }

    newRecords.push(record);
    added++;

    // Global limit check
    if (limit !== "unlimited" && stateMachine.stats.valid + added >= limit) {
      logger.info(`Unified limit reached: ${limit}`);
      break;
    }
  }

  // Persist to IndexedDB
  if (newRecords.length > 0) {
    try {
      await saveResults(newRecords);
    } catch (err) {
      logger.error(`Failed to save results to IndexedDB: ${err.message}`);
    }
  }

  // Update state statistics
  stateMachine.recordBatch({ added, duplicates, errors, aiFlagged, platform });

  // Broadcast results to dashboard
  if (newRecords.length > 0) {
    broadcastToDashboard({
      type: MSG.RESULT_BATCH,
      payload: { results: newRecords },
    });
  }

  broadcastToDashboard({
    type: MSG.EXTRACTION_PROGRESS,
    payload: stateMachine.stats,
  });

  // Check if limit reached
  if (limit !== "unlimited" && stateMachine.stats.valid >= limit) {
    logger.info("Target extraction limit reached — finishing all workers");
    await stopExtraction("Extraction limit reached");
  }
}

/**
 * Handle status update from a content script worker.
 */
export function handleContentStatus(payload, tabId) {
  const platform = _tabPlatformMap.get(tabId) || payload.platform || "unknown";
  const { status, message } = payload;

  logger.info(`[${platform}] Worker status: ${status} (${message || ""})`);

  if (status === "COMPLETED") {
    stateMachine.setPlatformStatus(platform, WORKER_STATUS.COMPLETED);
    broadcastToDashboard({
      type: MSG.PLATFORM_STATUS_UPDATE,
      payload: { platform, status: WORKER_STATUS.COMPLETED, message },
    });

    checkAllWorkersCompleted();
  } else if (status === "ERROR") {
    stateMachine.setPlatformStatus(platform, WORKER_STATUS.ERROR, { error: message });
    broadcastToDashboard({
      type: MSG.PLATFORM_STATUS_UPDATE,
      payload: { platform, status: WORKER_STATUS.ERROR, error: message },
    });

    checkAllWorkersCompleted();
  }
}

function checkAllWorkersCompleted() {
  const stats = stateMachine.stats;
  const statuses = Object.values(stats.platformStatuses || {});
  const allDone = statuses.length > 0 && statuses.every((s) => s.status === WORKER_STATUS.COMPLETED || s.status === WORKER_STATUS.ERROR || s.status === WORKER_STATUS.DISABLED);

  if (allDone && stateMachine.isRunning) {
    logger.info("All platform workers completed — finalizing job");
    stateMachine.transition(EXTRACTION_STATES.COMPLETED);
    broadcastToDashboard({
      type: MSG.EXTRACTION_COMPLETED,
      payload: stateMachine.stats,
    });
    cleanup();
    stateMachine.reset();
  }
}

// ─── Injection & Tab Management ──────────────────────────────────────────────

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    let resolved = false;

    const cleanupAndResolve = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 2500); // SPA hydration delay
    };

    const timeout = setTimeout(() => {
      cleanupAndResolve();
    }, 15000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanupAndResolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab && tab.status === "complete") {
        cleanupAndResolve();
      }
    });
  });
}

async function injectAdapter(tabId, platform, config) {
  const adapterFiles = getAdapterFiles(platform);

  await chrome.scripting.executeScript({
    target: { tabId },
    files: adapterFiles,
  });

  await new Promise((r) => setTimeout(r, 600));

  await chrome.tabs.sendMessage(tabId, {
    type: MSG.CS_INIT,
    payload: {
      platform,
      keywords: config.keywords,
      limit: config.limit,
      region: config.region,
      settings: EXTRACTION_DEFAULTS,
    },
  });
}

function getAdapterFiles(platform) {
  const core = [
    "src/content/core/dom-utils.js",
    "src/content/core/scroll-manager.js",
    "src/content/core/extractor-utils.js",
    "src/content/core/base-adapter.js",
  ];

  const adapters = {
    [PLATFORMS.YOUTUBE]: ["src/content/youtube/youtube-adapter.js"],
    [PLATFORMS.INSTAGRAM]: ["src/content/instagram/instagram-adapter.js"],
    [PLATFORMS.X]: ["src/content/x/x-adapter.js"],
    [PLATFORMS.FACEBOOK]: ["src/content/facebook/facebook-adapter.js"],
    [PLATFORMS.REDDIT]: ["src/content/reddit/reddit-adapter.js"],
  };

  return [...core, ...(adapters[platform] || [])];
}

function cleanup() {
  if (_timeoutTimer) {
    clearTimeout(_timeoutTimer);
    _timeoutTimer = null;
  }
}

export async function clearAllResults() {
  await clearResults();
  _knownIds = new Set();
  logger.info("All stored extraction results cleared");
}
