"use strict";

/**
 * dashboard.js — Full-screen Multi-Platform Intelligence & Research Suite.
 *
 * Supports concurrent extraction jobs across YouTube, X/Twitter, Instagram,
 * Reddit, and Facebook, with real-time NVIDIA AI scam classification, live per-platform
 * worker tracking, search filtering, and direct CSV/XLSX/JSON exports.
 */

const MSG = {
  START_EXTRACTION: "START_EXTRACTION",
  STOP_EXTRACTION: "STOP_EXTRACTION",
  PAUSE_EXTRACTION: "PAUSE_EXTRACTION",
  RESUME_EXTRACTION: "RESUME_EXTRACTION",
  GET_SETTINGS: "GET_SETTINGS",
  SAVE_SETTINGS: "SAVE_SETTINGS",
  EXPORT_CSV: "EXPORT_CSV",
  EXPORT_XLSX: "EXPORT_XLSX",
  EXPORT_JSON: "EXPORT_JSON",
  GET_RESULTS: "GET_RESULTS",
  CLEAR_RESULTS: "CLEAR_RESULTS",

  // Inbound
  RESULT_BATCH: "RESULT_BATCH",
  EXTRACTION_PROGRESS: "EXTRACTION_PROGRESS",
  EXTRACTION_STARTED: "EXTRACTION_STARTED",
  EXTRACTION_COMPLETED: "EXTRACTION_COMPLETED",
  EXTRACTION_ERROR: "EXTRACTION_ERROR",
  PLATFORM_STATUS_UPDATE: "PLATFORM_STATUS_UPDATE",
};

const state = {
  results: [],
  filterText: "",
  platformFilter: "all",
  threatFilter: "all",
  extraction: {
    status: "IDLE",
    discovered: 0,
    valid: 0,
    duplicates: 0,
    errors: 0,
    aiFlagged: 0,
    startedAt: null,
    limit: 100,
    platformStatuses: {},
  },
  elapsedTimerId: null,
};

// DOM references
const el = {
  connectionDot: document.getElementById("connectionDot"),
  connectionText: document.getElementById("connectionText"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  statTotal: document.getElementById("statTotal"),
  statValidSub: document.getElementById("statValidSub"),
  statPlatform: document.getElementById("statPlatform"),
  statPlatformSub: document.getElementById("statPlatformSub"),
  statAiFlagged: document.getElementById("statAiFlagged"),
  statSpeed: document.getElementById("statSpeed"),
  elapsedTime: document.getElementById("elapsedTime"),

  platformCheckboxes: document.querySelectorAll("input[name='platform']"),
  keywordInput: document.getElementById("keywordInput"),
  limitSelect: document.getElementById("limitSelect"),
  regionSelect: document.getElementById("regionSelect"),
  aiAnalysisToggle: document.getElementById("aiAnalysisToggle"),
  demoModeToggle: document.getElementById("demoModeToggle"),

  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  stopBtn: document.getElementById("stopBtn"),
  clearBtn: document.getElementById("clearBtn"),

  statusBadge: document.getElementById("statusBadge"),
  progressBarTrack: document.getElementById("progressBarTrack"),
  progressBarFill: document.getElementById("progressBarFill"),
  statDiscovered: document.getElementById("statDiscovered"),
  statValid: document.getElementById("statValid"),
  statDuplicates: document.getElementById("statDuplicates"),
  statErrors: document.getElementById("statErrors"),

  tableRecordCount: document.getElementById("tableRecordCount"),
  platformFilter: document.getElementById("platformFilter"),
  threatFilter: document.getElementById("threatFilter"),
  tableSearch: document.getElementById("tableSearch"),
  resultsTableBody: document.getElementById("resultsTableBody"),

  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportXlsxBtn: document.getElementById("exportXlsxBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),

  viewLogsBtn: document.getElementById("viewLogsBtn"),
  logsPanel: document.getElementById("logsPanel"),
  logsOutput: document.getElementById("logsOutput"),
  clearLogsBtn: document.getElementById("clearLogsBtn"),
};

// ─── Initialization ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await loadSavedSettings();
  await loadStoredResults();
  wireRuntimeMessages();
  log("INFO", "Social Research Intelligence Suite initialized");
}

function bindEvents() {
  // Fullscreen button
  if (el.fullscreenBtn) {
    el.fullscreenBtn.addEventListener("click", () => {
      if (chrome?.tabs?.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
      } else {
        window.open(window.location.href, "_blank");
      }
    });
  }

  // Configuration changes
  el.platformCheckboxes.forEach((cb) => cb.addEventListener("change", () => {
    updateActivePlatformsKpi();
    persistSettings();
  }));
  el.keywordInput.addEventListener("input", debounce(persistSettings, 400));
  el.limitSelect.addEventListener("change", persistSettings);
  el.regionSelect.addEventListener("change", persistSettings);
  el.aiAnalysisToggle.addEventListener("change", persistSettings);
  el.demoModeToggle.addEventListener("change", persistSettings);

  // Actions
  el.startBtn.addEventListener("click", onStartClicked);
  el.pauseBtn.addEventListener("click", onPauseClicked);
  el.stopBtn.addEventListener("click", onStopClicked);
  el.clearBtn.addEventListener("click", onClearClicked);

  // Filters
  el.tableSearch.addEventListener("input", debounce((e) => {
    state.filterText = e.target.value.trim().toLowerCase();
    renderTable();
  }, 150));

  el.platformFilter.addEventListener("change", (e) => {
    state.platformFilter = e.target.value;
    renderTable();
  });

  el.threatFilter.addEventListener("change", (e) => {
    state.threatFilter = e.target.value;
    renderTable();
  });

  // Exports
  el.exportCsvBtn.addEventListener("click", onExportCsv);
  el.exportXlsxBtn.addEventListener("click", onExportXlsx);
  el.exportJsonBtn.addEventListener("click", onExportJson);

  // Logs
  el.viewLogsBtn.addEventListener("click", () => {
    el.logsPanel.hidden = !el.logsPanel.hidden;
  });
  if (el.clearLogsBtn) {
    el.clearLogsBtn.addEventListener("click", () => {
      el.logsOutput.textContent = "";
    });
  }
}

// ─── Settings Persistence ───────────────────────────────────────────────────

async function loadSavedSettings() {
  const defaults = {
    platforms: ["youtube", "x", "reddit", "instagram"],
    keyword: "#financialscam",
    limit: "100",
    region: "india",
    enableAi: true,
    demoMode: false,
  };

  const settings = await getStorage("settings", defaults);

  const activePlatforms = Array.isArray(settings.platforms) ? settings.platforms : [settings.platform || "youtube"];
  el.platformCheckboxes.forEach((cb) => {
    cb.checked = activePlatforms.includes(cb.value);
  });

  el.keywordInput.value = settings.keyword || "#financialscam";
  el.limitSelect.value = settings.limit || "100";
  el.regionSelect.value = settings.region || "india";
  el.aiAnalysisToggle.checked = settings.enableAi !== false;
  el.demoModeToggle.checked = Boolean(settings.demoMode);

  updateActivePlatformsKpi();
}

function persistSettings() {
  const selectedPlatforms = Array.from(el.platformCheckboxes)
    .filter((cb) => cb.checked && !cb.disabled)
    .map((cb) => cb.value);

  const settings = {
    platforms: selectedPlatforms,
    keyword: el.keywordInput.value,
    limit: el.limitSelect.value,
    region: el.regionSelect.value,
    enableAi: el.aiAnalysisToggle.checked,
    demoMode: el.demoModeToggle.checked,
  };

  setStorage("settings", settings);
}

function updateActivePlatformsKpi() {
  const selected = Array.from(el.platformCheckboxes)
    .filter((cb) => cb.checked && !cb.disabled)
    .map((cb) => cb.value);

  if (selected.length === 0) {
    el.statPlatform.textContent = "None Selected";
    el.statPlatformSub.textContent = "Please select a platform";
  } else if (selected.length === 1) {
    el.statPlatform.textContent = platformLabel(selected[0]);
    el.statPlatformSub.textContent = "Single Worker Mode";
  } else {
    el.statPlatform.textContent = `${selected.length} Platforms`;
    el.statPlatformSub.textContent = selected.map(platformLabel).join(", ");
  }
}

// ─── Data Loading ───────────────────────────────────────────────────────────

async function loadStoredResults() {
  try {
    const res = await sendRuntimeMessage({ type: MSG.GET_RESULTS });
    if (res?.ok && Array.isArray(res.results)) {
      state.results = res.results;
      state.extraction.valid = res.results.length;
      state.extraction.discovered = res.results.length;
      state.extraction.aiFlagged = res.results.filter((r) => r.is_scam || (r.risk_score && r.risk_score >= 60)).length;
      renderTable();
      renderSummaryCards();
    }
  } catch {
    // Offline / Standalone mode
  }
}

// ─── Extraction Controls ────────────────────────────────────────────────────

async function onStartClicked() {
  const selectedPlatforms = Array.from(el.platformCheckboxes)
    .filter((cb) => cb.checked && !cb.disabled)
    .map((cb) => cb.value);

  if (selectedPlatforms.length === 0) {
    alert("Please select at least one active platform.");
    return;
  }

  const rawKeywords = el.keywordInput.value.trim();
  if (!rawKeywords) {
    alert("Please enter at least one keyword or hashtag.");
    return;
  }

  const keywords = parseKeywords(rawKeywords);

  const config = {
    platforms: selectedPlatforms,
    keywords,
    limit: el.limitSelect.value === "unlimited" ? "unlimited" : parseInt(el.limitSelect.value, 10),
    region: el.regionSelect.value,
    enableAi: el.aiAnalysisToggle.checked,
    demoMode: el.demoModeToggle.checked,
  };

  state.extraction.limit = config.limit;
  setExtractionStatus("INITIALIZING");

  el.startBtn.disabled = true;
  el.pauseBtn.disabled = false;
  el.stopBtn.disabled = false;
  startElapsedTimer();

  // Reset worker card indicators
  selectedPlatforms.forEach((p) => {
    updateWorkerCardStatus(p, "RUNNING", 0);
  });

  log("INFO", `Starting unified extraction across [${selectedPlatforms.join(", ")}] for keywords: ${JSON.stringify(keywords)}`);

  if (config.demoMode) {
    runMultiPlatformDemoExtraction(config);
    return;
  }

  try {
    await sendRuntimeMessage({ type: MSG.START_EXTRACTION, payload: config });
  } catch (err) {
    log("ERROR", `Failed to reach background extraction manager: ${err.message}`);
    setExtractionStatus("ERROR");
    resetControls();
  }
}

async function onPauseClicked() {
  if (state.extraction.status === "PAUSED") {
    setExtractionStatus("EXTRACTING");
    el.pauseBtn.innerHTML = `<span class="btn-icon">⏸</span> Pause`;
    await sendRuntimeMessage({ type: MSG.RESUME_EXTRACTION });
    log("INFO", "Resumed extraction workers");
  } else {
    setExtractionStatus("PAUSED");
    el.pauseBtn.innerHTML = `<span class="btn-icon">▶</span> Resume`;
    await sendRuntimeMessage({ type: MSG.PAUSE_EXTRACTION });
    log("INFO", "Paused extraction workers");
  }
}

async function onStopClicked() {
  setExtractionStatus("STOPPING");
  log("INFO", "Stopping all platform workers");
  try {
    await sendRuntimeMessage({ type: MSG.STOP_EXTRACTION });
  } catch (err) {
    log("WARN", `Stop message error: ${err.message}`);
  }
  finishExtraction("COMPLETED");
}

async function onClearClicked() {
  if (!confirm("Clear all extracted results and reset dashboard?")) return;

  state.results = [];
  state.extraction = {
    status: "IDLE",
    discovered: 0,
    valid: 0,
    duplicates: 0,
    errors: 0,
    aiFlagged: 0,
    startedAt: null,
    limit: 100,
    platformStatuses: {},
  };

  try {
    await sendRuntimeMessage({ type: MSG.CLEAR_RESULTS });
  } catch {
    // Ignore
  }

  ["youtube", "x", "reddit", "instagram"].forEach((p) => {
    updateWorkerCardStatus(p, "READY", 0);
  });

  renderTable();
  renderProgress();
  renderSummaryCards();
  setExtractionStatus("IDLE");
  stopElapsedTimer();
  el.elapsedTime.textContent = "00:00:00";
  log("INFO", "All results and queue statistics cleared");
}

function resetControls() {
  el.startBtn.disabled = false;
  el.pauseBtn.disabled = true;
  el.pauseBtn.innerHTML = `<span class="btn-icon">⏸</span> Pause`;
  el.stopBtn.disabled = true;
  stopElapsedTimer();
}

function finishExtraction(status) {
  setExtractionStatus(status);
  resetControls();
}

// ─── Runtime Messages from Service Worker ───────────────────────────────────

function wireRuntimeMessages() {
  if (!chrome?.runtime?.onMessage) return;

  chrome.runtime.onMessage.addListener((message) => {
    switch (message?.type) {
      case MSG.RESULT_BATCH:
        ingestRecords(message.payload.results);
        break;

      case MSG.EXTRACTION_PROGRESS:
        Object.assign(state.extraction, message.payload);
        renderProgress();
        renderSummaryCards();
        break;

      case MSG.PLATFORM_STATUS_UPDATE:
        const { platform, status, count, error } = message.payload;
        updateWorkerCardStatus(platform, status, count, error);
        break;

      case MSG.EXTRACTION_STARTED:
        setExtractionStatus("EXTRACTING");
        break;

      case MSG.EXTRACTION_COMPLETED:
        finishExtraction("COMPLETED");
        log("INFO", "All platform workers completed job");
        break;

      case MSG.EXTRACTION_ERROR:
        log("ERROR", message.payload?.message || "Extraction error");
        finishExtraction("ERROR");
        break;

      case MSG.LOG_ENTRY:
        if (message.payload) {
          log(message.payload.level, message.payload.message, message.payload.source);
        }
        break;
    }
  });
}

// ─── Ingest & Process Records ───────────────────────────────────────────────

function ingestRecords(batch) {
  if (!batch || batch.length === 0) return;

  state.extraction.discovered += batch.length;
  const existingIds = new Set(state.results.map((r) => r.id || r.normalizedUrl));
  let added = 0;

  for (const rec of batch) {
    const key = rec.id || rec.normalizedUrl;
    if (existingIds.has(key)) {
      state.extraction.duplicates += 1;
      continue;
    }

    existingIds.add(key);
    state.results.unshift(rec); // Latest on top
    added += 1;

    if (rec.fraud_category && rec.fraud_category !== "Neutral/Unrelated" && rec.fraud_category !== "Legitimate/Informational") {
      state.extraction.aiFlagged += 1;
    }
  }

  state.extraction.valid += added;
  renderTable();
  renderProgress();
  renderSummaryCards();
}

// ─── Multi-Platform Demo Simulation ─────────────────────────────────────────

function runMultiPlatformDemoExtraction(config) {
  setExtractionStatus("EXTRACTING");
  const platforms = config.platforms;
  let batchIndex = 0;

  const interval = setInterval(() => {
    if (state.extraction.status === "STOPPING" || state.extraction.status === "IDLE") {
      clearInterval(interval);
      return;
    }

    if (batchIndex >= 6) {
      clearInterval(interval);
      platforms.forEach((p) => updateWorkerCardStatus(p, "COMPLETED"));
      finishExtraction("COMPLETED");
      log("INFO", `Demo multi-platform extraction completed with ${state.results.length} records`);
      return;
    }

    const currentPlatform = platforms[batchIndex % platforms.length];
    updateWorkerCardStatus(currentPlatform, "RUNNING", (batchIndex + 1) * 3);

    const mockBatch = generateMultiPlatformMockBatch(currentPlatform, config.keywords, 3);
    ingestRecords(mockBatch);

    batchIndex++;
  }, 450);
}

function generateMultiPlatformMockBatch(platform, keywords, count) {
  const kw = keywords[0] || "#financialscam";
  const cleanKw = kw.replace(/^#/, "");
  const now = new Date().toISOString();
  const out = [];

  const threatScenarios = [
    { cat: "Investment Scam", score: 92, desc: `High-yield guaranteed trading scheme promise on ${platform} (${kw})` },
    { cat: "Task/Part-Time Job Fraud", score: 88, desc: `Daily payout online task fraud scam telegram channel link #${cleanKw}` },
    { cat: "UPI/Banking Fraud", score: 95, desc: `Fake bank KYC update APK malware download scam alert #${cleanKw}` },
    { cat: "Fake Trading App/SEBI Impersonation", score: 85, desc: `Unregulated stock tips group posing as SEBI advisor #${cleanKw}` },
    { cat: "Legitimate/Informational", score: 10, desc: `Cyber Police official advisory on identifying financial fraud schemes` },
  ];

  const urls = {
    youtube: "https://www.youtube.com/shorts/4kPBowlxmqE",
    x: `https://x.com/search?q=${encodeURIComponent(kw)}`,
    reddit: "https://www.reddit.com/r/Scams/",
    instagram: `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanKw)}/`,
    facebook: `https://www.facebook.com/hashtag/${encodeURIComponent(cleanKw)}`,
  };

  for (let i = 0; i < count; i++) {
    const n = state.results.length + out.length + 1;
    const scenario = threatScenarios[(n - 1) % threatScenarios.length];

    out.push({
      id: `${platform}-mock-${n}-${Date.now()}`,
      platform,
      caption: `[${platformLabel(platform)}] ${scenario.desc}`,
      url: urls[platform] || "https://www.youtube.com",
      normalizedUrl: urls[platform] || "https://www.youtube.com",
      keywords,
      hashtags: [`#${cleanKw}`, "#cyberfraud", "#financialcrime"],
      author: `${platform}_user_${n}`,
      publishedAt: now,
      collectedAt: now,
      fraud_category: scenario.cat,
      risk_score: scenario.score,
      language: /[\u0900-\u097F]/.test(scenario.desc) ? "Hindi" : "English",
      ai_summary: `NVIDIA AI identified ${scenario.cat} with ${scenario.score}% confidence.`,
      status: "valid",
    });
  }

  return out;
}

// ─── Rendering Helpers ───────────────────────────────────────────────────────

function setExtractionStatus(status) {
  state.extraction.status = status;
  el.statusBadge.textContent = status;
  el.statusBadge.className = "badge " + ({
    EXTRACTING: "badge--active",
    SEARCHING: "badge--active",
    SCROLLING: "badge--active",
    PAUSED: "badge--neutral",
    COMPLETED: "badge--success",
    ERROR: "badge--error",
  }[status] || "badge--neutral");

  const active = ["INITIALIZING", "SEARCHING", "EXTRACTING", "SCROLLING"].includes(status);
  const errored = status === "ERROR";
  el.connectionDot.className = "status-dot " + (errored ? "status-dot--error" : active ? "status-dot--active" : "status-dot--idle");
  el.connectionText.textContent = errored ? "Error" : active ? "Extracting..." : status === "PAUSED" ? "Paused" : "Ready";
}

function updateWorkerCardStatus(platform, status, count = null, error = "") {
  const card = document.getElementById(`worker-${platform}`);
  const statusEl = document.getElementById(`status-${platform}`);
  const progressEl = document.getElementById(`progress-${platform}`);
  const countEl = document.getElementById(`count-${platform}`);

  if (!card) return;

  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className = "badge " + (status === "RUNNING" ? "badge--active" : status === "COMPLETED" ? "badge--success" : status === "ERROR" ? "badge--error" : "badge--neutral");
  }

  if (count != null && countEl) {
    countEl.textContent = count;
  }

  if (progressEl) {
    progressEl.style.width = status === "RUNNING" ? "65%" : status === "COMPLETED" ? "100%" : "0%";
  }
}

function renderProgress() {
  const { discovered, valid, duplicates, errors, limit } = state.extraction;
  el.statDiscovered.textContent = discovered;
  el.statValid.textContent = valid;
  el.statDuplicates.textContent = duplicates;
  el.statErrors.textContent = errors;

  if (limit === "unlimited") {
    el.progressBarTrack.classList.add("indeterminate");
    el.progressBarFill.style.width = "";
  } else {
    el.progressBarTrack.classList.remove("indeterminate");
    const pct = limit > 0 ? Math.min(100, Math.round((valid / limit) * 100)) : 0;
    el.progressBarFill.style.width = pct + "%";
  }
}

function renderSummaryCards() {
  el.statTotal.textContent = state.results.length;
  el.statValidSub.textContent = `${state.extraction.valid} valid records`;
  el.statAiFlagged.textContent = state.extraction.aiFlagged;

  if (state.extraction.startedAt) {
    const minutes = Math.max((Date.now() - state.extraction.startedAt) / 60000, 1 / 60);
    el.statSpeed.textContent = (state.extraction.valid / minutes).toFixed(1) + "/min";
  }
}

function renderTable() {
  const filtered = state.results.filter((r) => {
    // Search text filter
    if (state.filterText) {
      const match = (r.caption || "").toLowerCase().includes(state.filterText)
        || (r.url || "").toLowerCase().includes(state.filterText)
        || (r.author || "").toLowerCase().includes(state.filterText)
        || (r.fraud_category || "").toLowerCase().includes(state.filterText);
      if (!match) return false;
    }

    // Platform filter
    if (state.platformFilter !== "all" && r.platform !== state.platformFilter) {
      return false;
    }

    // Threat level filter
    if (state.threatFilter === "scam_only") {
      const isScam = r.is_scam || (r.risk_score && r.risk_score >= 60);
      if (!isScam) return false;
    }

    return true;
  });

  el.tableRecordCount.textContent = filtered.length;

  if (filtered.length === 0) {
    el.resultsTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">${state.results.length === 0 ? "No records yet. Select platforms and click Start Unified Extraction." : "No records match current search / threat filter."}</td>
      </tr>`;
    return;
  }

  const frag = document.createDocumentFragment();

  filtered.forEach((r, idx) => {
    const tr = document.createElement("tr");

    // 1. Index
    const indexTd = document.createElement("td");
    indexTd.textContent = String(idx + 1);
    tr.appendChild(indexTd);

    // 2. Platform Tag
    const platTd = document.createElement("td");
    const platTag = document.createElement("span");
    platTag.className = `platform-tag platform-tag--${r.platform}`;
    platTag.textContent = platformLabel(r.platform);
    platTd.appendChild(platTag);
    tr.appendChild(platTd);

    // 3. Caption / Title
    const captionTd = document.createElement("td");
    captionTd.textContent = r.caption || "—";
    tr.appendChild(captionTd);

    // 4. AI Fraud Category
    const fraudTd = document.createElement("td");
    const fraudTag = document.createElement("span");
    const isScam = r.risk_score >= 60 || (r.fraud_category && !["Neutral/Unrelated", "Legitimate/Informational"].includes(r.fraud_category));
    fraudTag.className = `threat-tag ${isScam ? "threat-tag--scam" : "threat-tag--neutral"}`;
    fraudTag.textContent = r.fraud_category || "Unclassified";
    fraudTd.appendChild(fraudTag);
    tr.appendChild(fraudTd);

    // 5. Risk Score
    const riskTd = document.createElement("td");
    if (r.risk_score != null) {
      const scoreSpan = document.createElement("span");
      scoreSpan.className = `risk-meter ${r.risk_score >= 70 ? "risk-meter--high" : r.risk_score >= 40 ? "risk-meter--med" : "risk-meter--low"}`;
      scoreSpan.textContent = `${r.risk_score}%`;
      riskTd.appendChild(scoreSpan);
    } else {
      riskTd.textContent = "—";
    }
    tr.appendChild(riskTd);

    // 6. Language
    const langTd = document.createElement("td");
    langTd.textContent = r.language || "—";
    tr.appendChild(langTd);

    // 7. Author
    const authorTd = document.createElement("td");
    authorTd.textContent = r.author || "—";
    tr.appendChild(authorTd);

    // 8. Post URL
    const urlTd = document.createElement("td");
    urlTd.className = "url-cell";
    const a = document.createElement("a");
    a.href = r.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = truncate(r.url, 28);
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-url-btn";
    copyBtn.textContent = "copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(r.url);
      copyBtn.textContent = "copied!";
      setTimeout(() => { copyBtn.textContent = "copy"; }, 1500);
    });
    urlTd.append(a, copyBtn);
    tr.appendChild(urlTd);

    // 9. Date
    const dateTd = document.createElement("td");
    dateTd.textContent = formatDate(r.collectedAt);
    tr.appendChild(dateTd);

    frag.appendChild(tr);
  });

  el.resultsTableBody.innerHTML = "";
  el.resultsTableBody.appendChild(frag);
}

// ─── Export Handlers ─────────────────────────────────────────────────────────

async function onExportCsv() {
  if (state.results.length === 0) {
    alert("No results to export yet.");
    return;
  }
  try {
    await sendRuntimeMessage({ type: MSG.EXPORT_CSV });
    log("INFO", `Exported ${state.results.length} unified records to CSV via background downloader`);
  } catch {
    // Fallback in-memory
    const headers = ["#", "Platform", "Caption", "URL", "Fraud Category", "Risk Score", "Language", "Author", "Collected At"];
    const rows = state.results.map((r, i) => [
      i + 1, r.platform, r.caption, r.url, r.fraud_category || "", r.risk_score || "", r.language || "", r.author, r.collectedAt,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
    downloadBlob(csv, `social-research-export-${timestampFilename()}.csv`, "text/csv;charset=utf-8;");
  }
}

async function onExportXlsx() {
  if (state.results.length === 0) {
    alert("No results to export yet.");
    return;
  }
  try {
    await sendRuntimeMessage({ type: MSG.EXPORT_XLSX });
    log("INFO", `Exported ${state.results.length} unified records to XLSX spreadsheet`);
  } catch (err) {
    log("WARN", `XLSX export fallback: ${err.message}`);
    onExportCsv();
  }
}

async function onExportJson() {
  if (state.results.length === 0) {
    alert("No results to export yet.");
    return;
  }
  try {
    await sendRuntimeMessage({ type: MSG.EXPORT_JSON });
    log("INFO", `Exported complete JSON dataset with NVIDIA AI threat metadata`);
  } catch {
    const json = JSON.stringify({ dataset: state.results }, null, 2);
    downloadBlob(json, `social-research-dataset-${timestampFilename()}.json`, "application/json");
  }
}

// ─── General Helpers ─────────────────────────────────────────────────────────

function platformLabel(val) {
  const map = { youtube: "YouTube", x: "X / Twitter", reddit: "Reddit", instagram: "Instagram", facebook: "Facebook" };
  return map[val] || val;
}

function parseKeywords(raw) {
  const parts = raw.split(",").map((k) => k.trim()).filter(Boolean);
  return Array.from(new Set(parts));
}

function truncate(str, max) {
  if (!str) return "—";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function log(level, message, source = "dashboard") {
  const line = `[${new Date().toLocaleTimeString()}] [${level}] [${source}] ${message}`;
  if (el.logsOutput) {
    el.logsOutput.textContent += line + "\n";
    el.logsOutput.scrollTop = el.logsOutput.scrollHeight;
  }
}

function startElapsedTimer() {
  state.extraction.startedAt = Date.now();
  stopElapsedTimer();
  state.elapsedTimerId = setInterval(() => {
    const secs = Math.floor((Date.now() - state.extraction.startedAt) / 1000);
    const h = String(Math.floor(secs / 3600)).padStart(2, "0");
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    el.elapsedTime.textContent = `${h}:${m}:${s}`;
    renderSummaryCards();
  }, 1000);
}

function stopElapsedTimer() {
  if (state.elapsedTimerId) {
    clearInterval(state.elapsedTimerId);
    state.elapsedTimerId = null;
  }
}

function csvEscape(val) {
  const s = String(val ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob(["\ufeff" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function timestampFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getStorage(key, fallback) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) { resolve(fallback); return; }
    chrome.storage.local.get([key], (res) => resolve(res?.[key] ?? fallback));
  });
}

function setStorage(key, value) {
  if (!chrome?.storage?.local) return;
  chrome.storage.local.set({ [key]: value });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.sendMessage) { reject(new Error("chrome.runtime unavailable")); return; }
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}
