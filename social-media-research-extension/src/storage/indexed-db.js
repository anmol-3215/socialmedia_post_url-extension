/**
 * indexed-db.js — IndexedDB wrapper for large result datasets.
 *
 * Result records (potentially thousands) are stored here rather than
 * chrome.storage.local which has size limits and is slower for bulk ops.
 */

import { createLogger } from "../shared/logger.js";

const logger = createLogger("indexed-db");

const DB_NAME = "SmartResearchDB";
const DB_VERSION = 1;
const RESULTS_STORE = "results";

/** @type {IDBDatabase|null} */
let _db = null;

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(RESULTS_STORE)) {
        const store = db.createObjectStore(RESULTS_STORE, { keyPath: "id" });
        store.createIndex("platform", "platform", { unique: false });
        store.createIndex("normalizedUrl", "normalizedUrl", { unique: false });
        store.createIndex("collectedAt", "collectedAt", { unique: false });
        store.createIndex("status", "status", { unique: false });
        logger.info("IndexedDB: created results store with indexes");
      }
    };

    request.onsuccess = (event) => {
      _db = event.target.result;

      // Handle unexpected close
      _db.onclose = () => {
        logger.warn("IndexedDB connection closed unexpectedly");
        _db = null;
      };

      logger.debug("IndexedDB opened successfully");
      resolve(_db);
    };

    request.onerror = (event) => {
      logger.error(`IndexedDB open error: ${event.target.error?.message}`);
      reject(event.target.error);
    };
  });
}

/**
 * Save a single result record.
 * @param {object} record - Must have an `id` field.
 * @returns {Promise<void>}
 */
export async function saveResult(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE, "readwrite");
    const store = tx.objectStore(RESULTS_STORE);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = (e) => {
      logger.error(`Failed to save result: ${e.target.error?.message}`);
      reject(e.target.error);
    };
  });
}

/**
 * Save multiple result records in a single transaction.
 * @param {object[]} records
 * @returns {Promise<number>} Number of records saved.
 */
export async function saveResults(records) {
  if (!records || records.length === 0) return 0;

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE, "readwrite");
    const store = tx.objectStore(RESULTS_STORE);
    let saved = 0;

    for (const record of records) {
      const request = store.put(record);
      request.onsuccess = () => { saved++; };
      request.onerror = (e) => {
        logger.warn(`Failed to save record ${record.id}: ${e.target.error?.message}`);
      };
    }

    tx.oncomplete = () => {
      logger.debug(`Saved ${saved} records to IndexedDB`);
      resolve(saved);
    };
    tx.onerror = (e) => {
      logger.error(`Batch save transaction error: ${e.target.error?.message}`);
      reject(e.target.error);
    };
  });
}

/**
 * Get all stored results, ordered by collectedAt.
 * @returns {Promise<object[]>}
 */
export async function getResults() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE, "readonly");
    const store = tx.objectStore(RESULTS_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => {
      logger.error(`Failed to get results: ${e.target.error?.message}`);
      reject(e.target.error);
    };
  });
}

/**
 * Get the count of stored results.
 * @returns {Promise<number>}
 */
export async function getResultCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE, "readonly");
    const store = tx.objectStore(RESULTS_STORE);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Check if a record with the given ID already exists.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function hasResult(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE, "readonly");
    const store = tx.objectStore(RESULTS_STORE);
    const request = store.getKey(id);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Get all existing IDs as a Set (for fast deduplication).
 * @returns {Promise<Set<string>>}
 */
export async function getExistingIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE, "readonly");
    const store = tx.objectStore(RESULTS_STORE);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result || []));
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Clear all stored results.
 * @returns {Promise<void>}
 */
export async function clearResults() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE, "readwrite");
    const store = tx.objectStore(RESULTS_STORE);
    const request = store.clear();
    request.onsuccess = () => {
      logger.info("All results cleared from IndexedDB");
      resolve();
    };
    request.onerror = (e) => {
      logger.error(`Failed to clear results: ${e.target.error?.message}`);
      reject(e.target.error);
    };
  });
}

/**
 * Delete the entire database (for reset/cleanup).
 * @returns {Promise<void>}
 */
export async function deleteDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      logger.info("IndexedDB database deleted");
      resolve();
    };
    request.onerror = (e) => reject(e.target.error);
  });
}
