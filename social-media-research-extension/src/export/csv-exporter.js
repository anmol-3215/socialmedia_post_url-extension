/**
 * csv-exporter.js — CSV export from IndexedDB results.
 *
 * Runs in the service worker context. Uses data-URLs because
 * URL.createObjectURL is not available in service workers.
 *
 * Features:
 *   - UTF-8 BOM so Excel correctly opens Hindi/Unicode content
 *   - RFC 4180–compliant escaping (commas, quotes, newlines)
 *   - chrome.downloads API for save-as dialog
 */

import { getResults } from "../storage/indexed-db.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("csv-exporter");

const CSV_HEADERS = [
  "#", "Platform", "Caption", "URL", "Keywords/Hashtags",
  "Author", "Date", "Fraud Category", "Risk Score", "Language", "AI Summary", "Collected At",
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Export all stored results to a CSV file via chrome.downloads.
 * @returns {Promise<void>}
 */
export async function exportResultsCsv() {
  const results = await getResults();
  if (results.length === 0) {
    logger.warn("No results to export");
    return;
  }

  const rows = results.map((r, i) => [
    i + 1,
    r.platform || "",
    r.caption || "",
    r.url || "",
    [...(r.hashtags || []), ...(r.keywords || [])].filter(uniqueFilter).join(" "),
    r.author || "",
    r.publishedAt || "",
    r.fraud_category || "Unclassified",
    r.risk_score != null ? `${r.risk_score}%` : "—",
    r.language || "—",
    r.ai_summary || "",
    r.collectedAt || "",
  ]);

  const csvContent = [CSV_HEADERS, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");

  const bom = "\ufeff";
  const dataUrl = stringToDataUrl(bom + csvContent, "text/csv;charset=utf-8");
  const filename = `research-export-${timestampFilename()}.csv`;

  try {
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
    logger.info(`Exported ${results.length} records to CSV: ${filename}`);
  } catch (err) {
    logger.error(`CSV download failed: ${err.message}`);
    throw err;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Escape a value for CSV per RFC 4180.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 */
function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert a string to a base64 data URL.
 * Handles Unicode correctly via TextEncoder.
 */
function stringToDataUrl(str, mimeType) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function timestampFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function uniqueFilter(value, index, arr) {
  return arr.indexOf(value) === index;
}
