/**
 * json-exporter.js — Direct JSON dataset exporter for AI/ML pipelines.
 *
 * Exports all normalized social media records with AI classifications,
 * timestamps, and threat entities into a standardized JSON format.
 */

import { getResults } from "../storage/indexed-db.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("json-exporter");

/**
 * Export all stored results as a formatted JSON file.
 * @returns {Promise<void>}
 */
export async function exportResultsJson() {
  const results = await getResults();
  if (results.length === 0) {
    logger.warn("No results to export");
    return;
  }

  const exportPayload = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalRecords: results.length,
      toolkit: "Social Media Research & Fraud Extraction Suite",
      version: "2.0.0",
    },
    records: results,
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const dataUrl = stringToDataUrl(jsonString, "application/json;charset=utf-8");
  const filename = `social-research-dataset-${timestampFilename()}.json`;

  try {
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
    logger.info(`Exported ${results.length} records to JSON: ${filename}`);
  } catch (err) {
    logger.error(`JSON download failed: ${err.message}`);
    throw err;
  }
}

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
