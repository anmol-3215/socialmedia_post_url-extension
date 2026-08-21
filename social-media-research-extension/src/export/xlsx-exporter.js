/**
 * xlsx-exporter.js — Pure-JS XLSX generator for MV3 service workers.
 *
 * Builds an Office Open XML (.xlsx) file from scratch without external
 * dependencies. The XLSX format is a ZIP archive of XML files — this module
 * includes a minimal ZIP builder using the STORE method (no compression
 * library required).
 *
 * Columns: #, Platform, Caption, URL, Keywords/Hashtags, Author, Date, Collected At
 */

import { getResults } from "../storage/indexed-db.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("xlsx-exporter");

const XLSX_HEADERS = [
  "#", "Platform", "Caption", "URL", "Keywords/Hashtags",
  "Author", "Date", "Fraud Category", "Risk Score", "Language", "AI Summary", "Collected At",
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Export all stored results to an XLSX file via chrome.downloads.
 * @returns {Promise<void>}
 */
export async function exportResultsXlsx() {
  const results = await getResults();
  if (results.length === 0) {
    logger.warn("No results to export");
    return;
  }

  const dataRows = results.map((r, i) => [
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

  const allRows = [XLSX_HEADERS, ...dataRows];

  // Build shared string table (all non-numeric cell values)
  const sharedStrings = [];
  const sharedStringMap = new Map();

  for (const row of allRows) {
    for (const cell of row) {
      if (typeof cell === "number") continue;
      const str = String(cell ?? "");
      if (!sharedStringMap.has(str)) {
        sharedStringMap.set(str, sharedStrings.length);
        sharedStrings.push(str);
      }
    }
  }

  // Build the XLSX ZIP archive
  const zip = new ZipBuilder();
  zip.addFile("[Content_Types].xml", buildContentTypes());
  zip.addFile("_rels/.rels", buildRootRels());
  zip.addFile("xl/workbook.xml", buildWorkbook());
  zip.addFile("xl/_rels/workbook.xml.rels", buildWorkbookRels());
  zip.addFile("xl/styles.xml", buildStyles());
  zip.addFile("xl/sharedStrings.xml", buildSharedStrings(sharedStrings));
  zip.addFile("xl/worksheets/sheet1.xml", buildSheet(allRows, sharedStringMap));

  const xlsxBytes = zip.build();

  // Convert to base64 data URL for chrome.downloads
  let binary = "";
  for (let i = 0; i < xlsxBytes.length; i++) {
    binary += String.fromCharCode(xlsxBytes[i]);
  }
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(binary)}`;

  const filename = `research-export-${timestampFilename()}.xlsx`;

  try {
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
    logger.info(`Exported ${results.length} records to XLSX: ${filename}`);
  } catch (err) {
    logger.error(`XLSX download failed: ${err.message}`);
    throw err;
  }
}

// ─── OOXML Builders ──────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildContentTypes() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;
}

function buildRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildWorkbook() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Research Data" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildWorkbookRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
}

function buildStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;
}

function buildSharedStrings(strings) {
  const items = strings.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
     count="${strings.length}" uniqueCount="${strings.length}">
${items}
</sst>`;
}

function buildSheet(rows, sharedStringMap) {
  const rowsXml = rows.map((row, rowIdx) => {
    const cells = row.map((cell, colIdx) => {
      const ref = colToLetter(colIdx) + (rowIdx + 1);
      if (typeof cell === "number") {
        return `<c r="${ref}"><v>${cell}</v></c>`;
      }
      const str = String(cell ?? "");
      const ssIdx = sharedStringMap.get(str);
      // Row 0 = header → bold style (s="1")
      const style = rowIdx === 0 ? ' s="1"' : "";
      return `<c r="${ref}" t="s"${style}><v>${ssIdx}</v></c>`;
    }).join("");
    return `<row r="${rowIdx + 1}">${cells}</row>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
${rowsXml}
  </sheetData>
</worksheet>`;
}

/** Convert 0-based column index to Excel letter (0→A, 25→Z, 26→AA, …). */
function colToLetter(idx) {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// ─── Minimal ZIP Builder (STORE method, no compression) ──────────────────────

class ZipBuilder {
  constructor() {
    /** @type {{ path: string, data: Uint8Array }[]} */
    this.files = [];
  }

  /**
   * Add a file to the archive.
   * @param {string} path - File path inside the ZIP.
   * @param {string|Uint8Array} content - File content.
   */
  addFile(path, content) {
    const data = typeof content === "string"
      ? new TextEncoder().encode(content)
      : content;
    this.files.push({ path, data });
  }

  /**
   * Build the ZIP archive as a Uint8Array.
   * @returns {Uint8Array}
   */
  build() {
    const encoder = new TextEncoder();
    const parts = [];     // local file header + data pairs
    const centralParts = []; // central directory entries
    let offset = 0;

    for (const file of this.files) {
      const pathBytes = encoder.encode(file.path);
      const crc = crc32(file.data);
      const dataLen = file.data.length;

      // ── Local file header (30 bytes + filename) ──
      const lfh = new Uint8Array(30 + pathBytes.length);
      const lfv = new DataView(lfh.buffer);
      lfv.setUint32(0, 0x04034b50, true);    // signature
      lfv.setUint16(4, 20, true);             // version needed
      lfv.setUint16(6, 0, true);              // general-purpose bit flag
      lfv.setUint16(8, 0, true);              // compression: STORE
      lfv.setUint16(10, 0, true);             // last mod time
      lfv.setUint16(12, 0, true);             // last mod date
      lfv.setUint32(14, crc, true);           // CRC-32
      lfv.setUint32(18, dataLen, true);       // compressed size
      lfv.setUint32(22, dataLen, true);       // uncompressed size
      lfv.setUint16(26, pathBytes.length, true); // filename length
      lfv.setUint16(28, 0, true);             // extra field length
      lfh.set(pathBytes, 30);

      parts.push(lfh, file.data);

      // ── Central directory entry (46 bytes + filename) ──
      const cde = new Uint8Array(46 + pathBytes.length);
      const cdv = new DataView(cde.buffer);
      cdv.setUint32(0, 0x02014b50, true);     // signature
      cdv.setUint16(4, 20, true);             // version made by
      cdv.setUint16(6, 20, true);             // version needed
      cdv.setUint16(8, 0, true);              // flags
      cdv.setUint16(10, 0, true);             // compression: STORE
      cdv.setUint16(12, 0, true);             // time
      cdv.setUint16(14, 0, true);             // date
      cdv.setUint32(16, crc, true);           // CRC-32
      cdv.setUint32(20, dataLen, true);       // compressed size
      cdv.setUint32(24, dataLen, true);       // uncompressed size
      cdv.setUint16(28, pathBytes.length, true); // filename length
      cdv.setUint16(30, 0, true);             // extra field length
      cdv.setUint16(32, 0, true);             // comment length
      cdv.setUint16(34, 0, true);             // disk number start
      cdv.setUint16(36, 0, true);             // internal file attrs
      cdv.setUint32(38, 0, true);             // external file attrs
      cdv.setUint32(42, offset, true);        // relative offset of local header
      cde.set(pathBytes, 46);

      centralParts.push(cde);
      offset += lfh.length + dataLen;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const cd of centralParts) centralDirSize += cd.length;

    // ── End of central directory (22 bytes) ──
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);         // signature
    ev.setUint16(4, 0, true);                  // disk number
    ev.setUint16(6, 0, true);                  // disk with central dir
    ev.setUint16(8, this.files.length, true);  // entries on this disk
    ev.setUint16(10, this.files.length, true); // total entries
    ev.setUint32(12, centralDirSize, true);    // central dir size
    ev.setUint32(16, centralDirOffset, true);  // central dir offset
    ev.setUint16(20, 0, true);                 // comment length

    // ── Assemble final buffer ──
    const total = offset + centralDirSize + 22;
    const result = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
      result.set(part, pos);
      pos += part.length;
    }
    for (const cd of centralParts) {
      result.set(cd, pos);
      pos += cd.length;
    }
    result.set(eocd, pos);

    return result;
  }
}

// ─── CRC-32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timestampFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function uniqueFilter(value, index, arr) {
  return arr.indexOf(value) === index;
}
