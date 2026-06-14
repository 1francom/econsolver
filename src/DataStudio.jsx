// ─── ECON STUDIO · DataStudio.jsx ────────────────────────────────────────────
// Multi-dataset manager.
// Manages a list of loaded datasets, exposes them to WranglingModule
// for JOIN / APPEND operations, and renders the active dataset's pipeline editor.
//
// External interface:
//   projectPid       {string}   – the project container id (registry key)
//   initialDatasets  {Array}    – optional [{ filename, rawData }] to seed when
//                                 the registry is empty (e.g. the demo project)
//   onComplete       {fn}       – (cleanedData) => void
//   onDatasetsChange {fn}       – (slimDatasetList) => void — mirror for parent
//   onActiveDatasetChange {fn}  – (datasetId) => void — last-worked-on dataset
//   activeDatasetId  {string}   – externally-selected active dataset
//
// There is no privileged "primary" dataset. All datasets are equal, individually
// deletable, and persisted to IndexedDB (registry metadata + raw_data rows), so
// they survive a browser close. Datasets are also exposed to WranglingModule's
// Merge tab for JOIN / APPEND.

import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import * as XLSX from "xlsx";
import { useTheme } from "./ThemeContext.jsx";
import WranglingModule from "./WranglingModule.jsx";
import { saveRawData, loadRawData, deleteRawData, saveDatasetRegistry, loadDatasetRegistry, saveProject } from "./services/Persistence/indexedDB.js";
import WorldBankFetcher from "./components/wrangling/WorldBankFetcher.jsx";
import OECDFetcher     from "./components/wrangling/OECDFetcher.jsx";
import { useSessionDispatch, registerDataset } from "./services/session/sessionState.jsx";
import { useSessionLogOptional } from "./services/session/sessionLog.jsx";
import { deleteCacheEntry } from "./services/data/parquetCache.js";
import { ensureRowIdentity } from "./services/data/rowIdentity.js";

// ─── THEME ────────────────────────────────────────────────────────────────────
// ─── UTILITIES ────────────────────────────────────────────────────────────────
function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
// Handles: RFC 4180 quoting, embedded commas/newlines, CRLF/LF, type inference.
// Detects and handles TSV automatically.
function parseCSV(text, delimiter = ",") {
  const NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|#na|\.\.?|\s*)$/i;

  function tokenize(line) {
    const fields = [];
    let i = 0;
    while (i <= line.length) {
      if (i === line.length) { fields.push(""); break; }
      if (line[i] === '"') {
        let field = ""; i++;
        while (i < line.length) {
          if (line[i] === '"') {
            if (line[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else { field += line[i++]; }
        }
        fields.push(field);
        if (line[i] === delimiter) i++;
      } else {
        const end = line.indexOf(delimiter, i);
        if (end === -1) { fields.push(line.slice(i)); break; }
        fields.push(line.slice(i, end)); i = end + 1;
      }
    }
    return fields;
  }

  const lines = text.split(/\r?\n/);
  const rawHeaders = tokenize(lines[0]);
  // Deduplicate headers (Excel often exports duplicates)
  const headerCount = {};
  const headers = rawHeaders.map(h => {
    const t = h.trim() || "col";
    headerCount[t] = (headerCount[t] || 0) + 1;
    return headerCount[t] === 1 ? t : `${t}_${headerCount[t]}`;
  });
  if (!headers.length) return null;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = tokenize(lines[i]);
    const row = {};
    headers.forEach((h, j) => {
      const raw = (vals[j] ?? "").trim();
      if (!raw || NA_PAT.test(raw)) { row[h] = null; return; }
      // Strip thousands separators before numeric parse
      const clean = raw.replace(/,(?=\d{3})/g, "");
      const n = Number(clean);
      row[h] = isNaN(n) ? raw : n;
    });
    rows.push(row);
  }
  return rows.length ? { headers, rows } : null;
}

// ─── EXCEL PARSER ─────────────────────────────────────────────────────────────
// Excel parser — uses the installed xlsx npm package (bundled by Vite).
async function parseExcel(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws  = wb.Sheets[sheetName];
  if (!ws) throw new Error("Excel file has no sheets.");
  const data = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  if (!data.length) throw new Error("Excel sheet is empty — no rows found.");

  const NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|\.|\s*)$/i;
  const headers = Object.keys(data[0]);
  const rows = data.map(r => {
    const row = {};
    headers.forEach(h => {
      const v = r[h];
      if (v === null || v === undefined) { row[h] = null; return; }
      if (typeof v === "number") { row[h] = v; return; }
      const t = String(v).trim();
      if (!t || NA_PAT.test(t)) { row[h] = null; return; }
      const n = Number(t.replace(/,(?=\d{3})/g, ""));
      row[h] = isNaN(n) ? t : n;
    });
    return row;
  });
  return { headers, rows, _sheetName: sheetName };
}

// ─── JSON PARSER ──────────────────────────────────────────────────────────────
// Accepts generic tabular JSON (array of objects, or {data|rows|records:[...]})
// AND the Observatorio admin-ajax payload. The latter is POSITIONAL
// (data:[[...]]) and carries name/fiscal PII in fixed columns, so it is routed
// through the dedicated parser that strips PII at the boundary — never loaded raw.
const JSON_NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|\.|\s*)$/i;

function looksLikeObservatorio(payload) {
  const data = payload?.data;
  return Array.isArray(data) && data.length > 0 && Array.isArray(data[0])
    && (typeof payload.recordsTotal === "number" || data[0].length >= 8);
}

function genericRecords(payload) {
  if (Array.isArray(payload)) return payload;
  for (const k of ["data", "rows", "records", "value"]) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  return null;
}

function coerceJsonValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") return JSON.stringify(v); // nested objects/arrays → text
  const t = String(v).trim();
  if (!t || JSON_NA_PAT.test(t)) return null;
  const n = Number(t.replace(/,(?=\d{3})/g, ""));
  return isNaN(n) ? t : n;
}

async function parseJSON(file) {
  const text = await file.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error(`"${file.name}" is not valid JSON.`); }

  // Privacy-first: Observatorio payload → PII-stripping parser.
  if (looksLikeObservatorio(payload)) {
    const { parseRegistry } = await import("./services/data/fetchers/observatorio.js");
    const { rows, headers } = parseRegistry(payload);
    if (!rows.length) throw new Error("Observatorio payload parsed to zero rows.");
    return { headers, rows };
  }

  const records = genericRecords(payload);
  if (!records || !records.length)
    throw new Error(`"${file.name}": no array of records found. Expected a JSON array or { data: [...] }.`);
  if (records.some(r => Array.isArray(r) || r === null || typeof r !== "object"))
    throw new Error(`"${file.name}": JSON rows must be objects with named fields. Headerless/positional JSON is not supported here.`);

  // Headers = first-seen union of keys across all records.
  const headers = [];
  const seen = new Set();
  for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); headers.push(k); }
  if (!headers.length) throw new Error(`"${file.name}": records have no fields.`);

  const rows = records.map(r => {
    const row = {};
    for (const h of headers) row[h] = coerceJsonValue(r[h]);
    return row;
  });
  return { headers, rows };
}

// ─── DELIMITER DETECTION ─────────────────────────────────────────────────────
// Samples up to 5 non-empty lines and picks the most frequent candidate delimiter.
// Handles comma, semicolon, tab, pipe — covers sep=",", sep=";", sep="\t", sep="|".
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return ",";
  // Use only the header line — data rows may contain commas/semicolons inside
  // values (e.g. WKT geometry coordinates), which would skew a multi-line count.
  const header = lines[0];
  const tabs   = (header.match(/\t/g)  || []).length;
  const commas = (header.match(/,/g)   || []).length;
  const semis  = (header.match(/;/g)   || []).length;
  const pipes  = (header.match(/\|/g)  || []).length;
  if (tabs  > commas && tabs  > semis && tabs  > pipes) return "\t";
  if (semis > commas && semis > pipes && semis > tabs)  return ";";
  if (pipes > commas && pipes > semis && pipes > tabs)  return "|";
  return ",";
}

// ─── FILE DISPATCHER ──────────────────────────────────────────────────────────
export async function parseFileForPrimary(file) { return parseFile(file); }

// Multi-file entrypoint. Groups shapefile companions (.shp/.dbf/.prj/.shx/.cpg)
// by basename so a single shapefile loaded as separate files (instead of a .zip)
// produces one dataset with its CRS detected, just like R sf::st_read() would.
// All other files are parsed independently — one dataset each.
// Returns: [{ filename, parsed?, error? }]
export async function parseFiles(fileList) {
  const files = Array.from(fileList || []);
  const groups = groupShapefileFiles(files);
  const out = [];
  for (const g of groups) {
    try {
      const parsed = await g.parse();
      if (parsed && parsed.rows?.length) out.push({ filename: g.filename, parsed });
      else out.push({ filename: g.filename, error: "No rows parsed." });
    } catch (e) {
      out.push({ filename: g.filename, error: e?.message || String(e) });
    }
  }
  return out;
}

// Group a flat list of File objects into logical datasets.
// Returns: [{ filename, parse: () => Promise<parsed> }]
function groupShapefileFiles(files) {
  const SHAPE_EXTS = new Set(["shp", "dbf", "prj", "shx", "cpg"]);
  const shapeBuckets = {};       // basename → { shp?, dbf?, prj?, ... }
  const singles      = [];

  for (const f of files) {
    const dot = f.name.lastIndexOf(".");
    const ext = dot >= 0 ? f.name.slice(dot + 1).toLowerCase() : "";
    const base = dot >= 0 ? f.name.slice(0, dot) : f.name;
    if (SHAPE_EXTS.has(ext)) {
      // Use lowercase basename so "x.SHP" and "x.dbf" group together
      const key = base.toLowerCase();
      if (!shapeBuckets[key]) shapeBuckets[key] = { _base: base };
      shapeBuckets[key][ext] = f;
    } else {
      singles.push(f);
    }
  }

  const out = [];

  // Singles — each is its own dataset
  for (const f of singles) {
    out.push({ filename: f.name, parse: () => parseFile(f) });
  }

  // Shapefile groups
  for (const key of Object.keys(shapeBuckets)) {
    const g = shapeBuckets[key];
    const base = g._base;
    if (g.dbf) {
      // dbf (+ optional shp + optional prj) → parseShapefile
      out.push({
        filename: `${base}.shp`,
        parse: async () => {
          const { parseShapefile } = await import("./services/data/parsers/shapefile.js");
          const dbfBuf = await g.dbf.arrayBuffer();
          const shpBuf = g.shp ? await g.shp.arrayBuffer() : null;
          const prjTxt = g.prj ? await g.prj.text() : null;
          return parseShapefile(dbfBuf, shpBuf, prjTxt);
        },
      });
    } else if (g.shp) {
      // .shp-only with optional .prj
      out.push({
        filename: `${base}.shp`,
        parse: async () => {
          const { parseSHPOnly } = await import("./services/data/parsers/shapefile.js");
          const shpBuf = await g.shp.arrayBuffer();
          const prjTxt = g.prj ? await g.prj.text() : null;
          return parseSHPOnly(shpBuf, prjTxt);
        },
      });
    }
    // (.prj or .shx alone with no .dbf/.shp → silently dropped)
  }

  return out;
}

// Attach load options to the parsed result so downstream consumers
// (sessionState, replication-script exports, AI Report) can faithfully
// recreate the load step. Mirrors the `_crs` / `_duckdb` attachment
// pattern already used by parseFile.
function withLoadOpts(parsed, loadOpts) {
  if (!parsed) return parsed;
  parsed._loadOpts = loadOpts;
  return parsed;
}

function datasetCrs(ds) {
  return ds?.crs ?? ds?.rawData?._crs ?? null;
}

function crsLine(crs) {
  if (!crs) return null;
  const epsg = crs.epsg ? `EPSG:${crs.epsg}` : "EPSG unknown";
  const kind = crs.kind ? `${crs.kind}` : "CRS";
  return `${epsg} | ${kind}${crs.reprojected ? " | reprojected" : ""}`;
}

function crsTitle(crs) {
  if (!crs) return "";
  const parts = [
    crs.label,
    crs.name && crs.name !== crs.label ? `Name: ${crs.name}` : null,
    crs.unit ? `Unit: ${crs.unit}` : null,
    crs.source ? `Source: ${crs.source}` : null,
    crs.confidence ? `Confidence: ${crs.confidence}` : null,
    crs.reprojected ? `Reprojected to ${crs.target}` : null,
    crs.warning,
  ].filter(Boolean);
  return parts.join("\n");
}

// K7 — magic-bytes + size guard. Called before any parser so users get a
// clear error instead of a cryptic parse failure or silent null result.
async function validateFileMagic(file) {
  const MAX_SIZE = 500 * 1024 * 1024; // 500 MB hard cap
  if (file.size > MAX_SIZE)
    throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(0)} MB — maximum upload size is 500 MB. Use Parquet or DuckDB for large datasets.`);

  const ext = file.name.split(".").pop().toLowerCase();
  if (["csv", "tsv", "txt", "json", "prj", "shx", "cpg"].includes(ext)) return; // text formats — no magic bytes

  if (file.size < 4) return; // too small to check — parser will handle it
  const buf = await file.slice(0, 8).arrayBuffer();
  const b = new Uint8Array(buf);

  if (ext === "xlsx") {
    if (b[0] !== 0x50 || b[1] !== 0x4B || b[2] !== 0x03 || b[3] !== 0x04)
      throw new Error(`"${file.name}" is not a valid Excel file — missing ZIP header. Is the file corrupted or saved as a different format?`);
  } else if (ext === "xls") {
    if (b[0] !== 0xD0 || b[1] !== 0xCF || b[2] !== 0x11 || b[3] !== 0xE0)
      throw new Error(`"${file.name}" is not a valid Excel 97-2003 file — missing OLE2 header.`);
  } else if (ext === "zip") {
    if (b[0] !== 0x50 || b[1] !== 0x4B)
      throw new Error(`"${file.name}" is not a valid ZIP file.`);
  } else if (ext === "parquet") {
    if (b[0] !== 0x50 || b[1] !== 0x41 || b[2] !== 0x52 || b[3] !== 0x31)
      throw new Error(`"${file.name}" is not a valid Parquet file — missing PAR1 magic bytes.`);
  } else if (ext === "shp") {
    const code = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
    if (code !== 9994)
      throw new Error(`"${file.name}" is not a valid shapefile — expected file code 9994, got ${code}.`);
  } else if (ext === "dbf") {
    const VALID = new Set([0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x83, 0x8B, 0x8C, 0xF5]);
    if (!VALID.has(b[0]))
      throw new Error(`"${file.name}" is not a valid DBF file — unexpected version byte 0x${b[0].toString(16).padStart(2, "0")}.`);
  } else if (ext === "dta") {
    // Stata 13+ XML: starts with '<' (0x3C); legacy binary: version byte 108–121
    if (b[0] !== 0x3C && !(b[0] >= 108 && b[0] <= 121))
      throw new Error(`"${file.name}" is not a valid Stata .dta file — unrecognised file header.`);
  } else if (ext === "rds") {
    // R serialisation: 'X\n' (XDR), 'A\n' (ASCII), or 'B\n' (binary)
    if (!((b[0] === 0x58 || b[0] === 0x41 || b[0] === 0x42) && b[1] === 0x0A))
      throw new Error(`"${file.name}" is not a valid R data file (.rds) — unrecognised serialisation header.`);
  }
}

async function parseFile(file) {
  await validateFileMagic(file);
  const ext = file.name.split(".").pop().toLowerCase();
  if (["csv", "txt"].includes(ext)) {
    if (file.size > 10 * 1024 * 1024) {
      const { loadLargeCSV } = await import("./services/data/duckdb.js");
      // DuckDB auto-detects delimiter — record as "auto" so exports can mirror that.
      return withLoadOpts(await loadLargeCSV(file), { format: "csv", delimiter: "auto", engine: "duckdb" });
    }
    const text = await file.text();
    const delimiter = detectDelimiter(text);
    return withLoadOpts(parseCSV(text, delimiter), { format: "csv", delimiter, encoding: "utf-8" });
  }
  if (ext === "tsv") {
    if (file.size > 10 * 1024 * 1024) {
      const { loadLargeCSV } = await import("./services/data/duckdb.js");
      return withLoadOpts(await loadLargeCSV(file), { format: "tsv", delimiter: "\t", engine: "duckdb" });
    }
    const text = await file.text();
    return withLoadOpts(parseCSV(text, "\t"), { format: "tsv", delimiter: "\t", encoding: "utf-8" });
  }
  if (["xlsx", "xls"].includes(ext)) {
    const parsed = await parseExcel(file);
    return withLoadOpts(parsed, { format: "excel", sheetName: parsed?._sheetName ?? null });
  }
  if (ext === "json") {
    return withLoadOpts(await parseJSON(file), { format: "json", encoding: "utf-8" });
  }
  if (ext === "dta") {
    const { parseStata } = await import("./services/data/parsers/stata.js");
    if (file.size > 10 * 1024 * 1024) {
      const { loadLargeParsedData } = await import("./services/data/duckdb.js");
      return withLoadOpts(await loadLargeParsedData(
        file,
        async () => parseStata(await file.arrayBuffer()),
        "stata"
      ), { format: "stata", engine: "duckdb" });
    }
    const buf = await file.arrayBuffer();
    return withLoadOpts(await parseStata(buf), { format: "stata" });
  }
  if (ext === "rds") {
    const { parseRDS } = await import("./services/data/parsers/rds.js");
    const buf = await file.arrayBuffer();
    return withLoadOpts(await parseRDS(buf), { format: "rds" });
  }
  if (ext === "parquet") {
    const { loadParquet } = await import("./services/data/duckdb.js");
    return withLoadOpts(await loadParquet(file), { format: "parquet", engine: "duckdb" });
  }
  if (ext === "dbf") {
    const { parseShapefile } = await import("./services/data/parsers/shapefile.js");
    const buf = await file.arrayBuffer();
    return withLoadOpts(await parseShapefile(buf, null), { format: "shapefile-dbf" });
  }
  if (ext === "zip") {
    const { unzipSync } = await import("fflate");
    const buf = await file.arrayBuffer();
    const files = unzipSync(new Uint8Array(buf));
    const keys = Object.keys(files);
    const shpKey = keys.find(k => k.toLowerCase().endsWith(".shp"));
    const dbfKey = keys.find(k => k.toLowerCase().endsWith(".dbf"));
    const prjKey = keys.find(k => k.toLowerCase().endsWith(".prj"));
    if (!dbfKey) throw new Error("ZIP contains no .dbf file. Upload a shapefile ZIP with both .shp and .dbf.");
    const { parseShapefile } = await import("./services/data/parsers/shapefile.js");
    const dbfArr = files[dbfKey];
    const dbfBuf = dbfArr.buffer.slice(dbfArr.byteOffset, dbfArr.byteOffset + dbfArr.byteLength);
    let shpBuf = null;
    if (shpKey) {
      const shpArr = files[shpKey];
      shpBuf = shpArr.buffer.slice(shpArr.byteOffset, shpArr.byteOffset + shpArr.byteLength);
    }
    let prjText = null;
    if (prjKey) {
      const prjArr = files[prjKey];
      prjText = new TextDecoder("utf-8").decode(prjArr);
    }
    return withLoadOpts(await parseShapefile(dbfBuf, shpBuf, prjText), { format: "shapefile-zip" });
  }
  if (ext === "shp") {
    const { parseSHPOnly } = await import("./services/data/parsers/shapefile.js");
    const buf = await file.arrayBuffer();
    return withLoadOpts(await parseSHPOnly(buf), { format: "shapefile-shp" });
  }
  // Unknown extension: try CSV as fallback with auto-detected delimiter
  try {
    const text = await file.text();
    const delimiter = detectDelimiter(text);
    return withLoadOpts(parseCSV(text, delimiter), { format: "csv", delimiter, encoding: "utf-8", fallback: true });
  } catch { return null; }
}

// ─── DATASET SIDEBAR ──────────────────────────────────────────────────────────
function DatasetSidebar({ datasets, activeId, onActivate, onRemove, onLoadFile, onFetchWorldBank, onFetchOECD, loadErr, loading }) {
  const { C, T } = useTheme();
  const fileRef = useRef();
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length) onLoadFile(files);
  }

  return (
    <div
      style={{
        width: 210, flexShrink: 0,
        background: C.surface,
        borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        height: "100%", overflow: "hidden",
        transition: "border-color 0.15s",
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* ── Header ── */}
      <div style={{
        padding: "0.9rem 0.85rem 0.6rem",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        <div style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>
          Dataset Manager
        </div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
          {datasets.length} dataset{datasets.length !== 1 ? "s" : ""} loaded
        </div>
      </div>

      {/* ── Dataset list ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.3rem 0" }}>
        {datasets.map((ds, idx) => {
          const isActive = ds.id === activeId;
          const crs = datasetCrs(ds);
          const crsSummary = crsLine(crs);
          return (
            <div
              key={ds.id}
              onClick={() => onActivate(ds.id)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 6,
                padding: "0.65rem 0.7rem",
                background: isActive ? `${C.teal}0d` : "transparent",
                borderLeft: `2px solid ${isActive ? C.teal : "transparent"}`,
                cursor: "pointer",
                transition: "background 0.1s, border-color 0.1s",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Index badge + status */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                  <span style={{
                    fontSize: T.caption.fontSize, padding: "1px 5px",
                    border: `1px solid ${isActive ? C.teal : C.border2}`,
                    color: isActive ? C.teal : C.textMuted,
                    borderRadius: 2, fontFamily: T.code.fontFamily, flexShrink: 0,
                    letterSpacing: "0.08em",
                  }}>
                    D{idx + 1}
                  </span>
                  {isActive && (
                    <span style={{ fontSize: T.caption.fontSize, color: C.teal, fontFamily: T.code.fontFamily }}>● active</span>
                  )}
                  {idx === 0 && !isActive && (
                    <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>primary</span>
                  )}
                </div>

                {/* Filename — truncated */}
                <div style={{
                  fontSize: T.code.fontSize, color: isActive ? C.text : C.textDim,
                  fontFamily: T.code.fontFamily, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                  lineHeight: 1.4, marginBottom: 2,
                }}>
                  {ds.filename}
                </div>

                {/* Dimensions */}
                <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
                  {(ds.rawData._duckdb?.rowCount ?? ds.rawData.rows.length).toLocaleString()} rows ×{" "}
                  {ds.rawData.headers.length} cols
                  {ds.rawData._duckdb && (
                    <span style={{ marginLeft: 5, color: C.teal, letterSpacing: "0.05em" }}>
                      {ds.rawData._duckdb.cached ? "· cached" : "· duckdb"}
                    </span>
                  )}
                </div>
                {crsSummary && (
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: T.caption.fontSize,
                      color: crs.reprojected ? C.gold : (crs.warning ? C.textMuted : C.teal),
                      fontFamily: T.code.fontFamily,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={crsTitle(crs)}
                  >
                    {crsSummary}
                  </div>
                )}
              </div>

              {/* Remove — only for non-primary datasets */}
              {idx > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); onRemove(ds.id); }}
                  title="Remove dataset"
                  style={{
                    background: "transparent", border: "none",
                    color: C.textMuted, cursor: "pointer",
                    fontSize: T.h2.fontSize, padding: "0 2px", lineHeight: 1,
                    flexShrink: 0, marginTop: 1,
                    transition: "color 0.1s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Load new dataset ── */}
      <div style={{
        padding: "0.7rem 0.75rem",
        borderTop: `1px solid ${C.border}`,
        flexShrink: 0,
        background: dragOver ? `${C.teal}08` : "transparent",
        transition: "background 0.15s",
      }}>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".csv,.tsv,.xlsx,.xls,.txt,.json,.dta,.rds,.dbf,.shp,.prj,.shx,.cpg,.parquet,.zip"
          style={{ display: "none" }}
          onChange={e => { if (e.target.files?.length) onLoadFile(e.target.files); e.target.value = ""; }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.55rem 0.5rem",
            background: dragOver ? `${C.teal}14` : "transparent",
            border: `1px dashed ${dragOver ? C.teal : C.border2}`,
            borderRadius: 3,
            color: loading ? C.textMuted : dragOver ? C.teal : C.textDim,
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
            transition: "all 0.12s",
          }}
          onMouseEnter={e => { if (!loading) { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; } }}
          onMouseLeave={e => { if (!loading && !dragOver) { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; } }}
        >
          {loading ? "Parsing…" : dragOver ? "Drop to load" : "+ Load dataset"}
        </button>

        {/* Error/info message */}
        {loadErr && (
          <div style={{ fontSize: T.caption.fontSize, color: loadErr.startsWith("Large file") ? C.gold : C.red, fontFamily: T.code.fontFamily, marginTop: 6, lineHeight: 1.5 }}>
            {loadErr}
          </div>
        )}

        {/* World Bank fetcher button */}
        <button
          onClick={onFetchWorldBank}
          style={{ width:"100%", marginTop:6, padding:"0.42rem 0.5rem", background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition:"all 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
        >↓ World Bank data</button>

        {/* OECD fetcher button */}
        <button
          onClick={onFetchOECD}
          style={{ width:"100%", marginTop:4, padding:"0.42rem 0.5rem", background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition:"all 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
        >↓ OECD data</button>

        {/* Format hint */}
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginTop: 6, lineHeight: 1.6 }}>
          CSV · TSV · XLSX · DTA · RDS · DBF · Parquet · drag & drop supported
          <br/>
          Loaded datasets available for JOIN / APPEND in the Merge tab.
        </div>
      </div>
    </div>
  );
}

// ─── DATA STUDIO ROOT ─────────────────────────────────────────────────────────
// Assigns stable row identity columns: `__ri` (sequential integer, used by
// the in-app patch step) and `__row_id` (UUID v4, used by replication
// scripts in R / Stata / Python to translate cell edits). See
// services/data/rowIdentity.js for invariants.
const ensureRowIds = ensureRowIdentity;

const DataStudio = forwardRef(function DataStudio({ projectPid, initialDatasets, onComplete, onOutputReady, onDatasetsChange, onActiveDatasetChange, activeDatasetId, assistantPrefill = null, onConsumePrefill = null }, ref) {
  const { C, T } = useTheme();
  const dispatch = useSessionDispatch();
  // Execution-timeline emitter (Fase 1.2) — no-op when outside the provider.
  const { appendLog } = useSessionLogOptional();

  // Ref exposed to WranglingModule so DataViewer can dispatch patch steps
  const wranglingAddStepRef = useRef(null);
  const addRowSeqRef = useRef(0);

  // Track which dataset IDs have already been registered in sessionState.
  // Prevents duplicate dispatches while ensuring every new dataset gets registered
  // regardless of which code path added it (handleLoadFile, handleSaveSubset, etc).
  const registeredIds = useRef(new Set());

  // Becomes true once the durable-registry rehydration effect has run. Until
  // then, the persistence effect must not overwrite the registry with an empty
  // list — that early write would wipe persisted datasets before they are
  // restored from IndexedDB on mount.
  const hydratedRef = useRef(false);

  // No privileged "primary" dataset: start empty and hydrate the whole registry
  // (metadata) + each dataset's rows (raw_data) on mount.
  const [datasets, setDatasets] = useState([]);
  const [activeId, setActiveId]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [loadErr, setLoadErr]     = useState("");
  const [wbOpen,   setWbOpen]     = useState(false);
  const [oecdOpen, setOecdOpen]   = useState(false);

  // ── Hydrate the whole dataset list on mount ─────────────────────────────────
  // Load the durable registry (metadata) and each dataset's rows (raw_data).
  // If the registry is empty AND the parent supplied `initialDatasets` (e.g. the
  // demo project), seed those instead and persist them. There is no privileged
  // primary dataset and no migration of legacy pid-keyed projects.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const registry = await loadDatasetRegistry(projectPid);
        if (cancelled) return;

        if (registry.length) {
          const loaded = await Promise.all(registry.map(async m => {
            if (m.opfsCacheKey) {
              try {
                const { restoreCachedParquet } = await import("./services/data/duckdb.js");
                const restored = await restoreCachedParquet(m.opfsCacheKey, `project_${m.id}`);
                if (restored) return { meta: m, raw: restored };
              } catch (error) {
                console.warn("[DataStudio] OPFS restore failed, using IndexedDB preview:", error);
              }
            }
            const raw = await loadRawData(m.id);
            return raw && raw.rows?.length ? { meta: m, raw } : null;
          }));
          if (cancelled) return;
          const entries = loaded.filter(Boolean).map(({ meta, raw }) => ({
            id:       meta.id,
            filename: meta.filename,
            name:     meta.name ?? undefined,   // user-given display name (rename)
            // Restore loadOpts captured at parse time (delimiter/sheet/encoding) —
            // raw_data rows don't carry _loadOpts, only the registry meta does.
            // Without this, a reloaded project loses e.g. read_delim(";") in
            // replication scripts and falls back to extension inference.
            rawData:  ensureRowIds(raw._loadOpts || !meta.loadOpts ? raw : { ...raw, _loadOpts: meta.loadOpts }),
            crs:      meta.crs ?? raw?._crs ?? null,
            origin:   meta.origin ?? undefined,
            source:   meta.source ?? undefined,
          }));
          if (entries.length) {
            setDatasets(entries);
            const wanted = entries.some(e => e.id === activeDatasetId) ? activeDatasetId : entries[0].id;
            setActiveId(wanted);
          }
        } else if (Array.isArray(initialDatasets) && initialDatasets.length) {
          // Seed from parent-provided datasets (demo project). Persist rows so a
          // reopen rehydrates from IndexedDB like any other project.
          const entries = initialDatasets.map(d => {
            const id  = genId();
            const raw = ensureRowIds(d.rawData);
            saveRawData(id, raw);
            return { id, filename: d.filename || "dataset.csv", rawData: raw, crs: raw?._crs ?? null };
          });
          setDatasets(entries);
          setActiveId(entries[0].id);
        }
      } finally {
        if (!cancelled) hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []); // mount only — hydrate once per project (DataStudio is keyed by pid)

  // ── Persist the full registry + active dataset whenever they change ─────────
  // Rows already live in raw_data (written at add time); this stores metadata
  // for every dataset and the last-active id on the project record. Guarded so
  // the pre-hydration empty state never clobbers the durable registry.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveDatasetRegistry(projectPid, datasets.map(d => ({
      id:       d.id,
      filename: d.filename,
      name:     d.name ?? null,
      source:   d.source ?? "loaded",
      origin:   d.origin ?? null,
      crs:      datasetCrs(d),
      headers:  d.rawData?.headers ?? d.headers ?? [],
      loadOpts: d.rawData?._loadOpts ?? d.loadOpts ?? null,
      opfsCacheKey: d.rawData?._duckdb?.opfsCacheKey ?? null,
      rowCount: d.rawData?._duckdb?.rowCount ?? d.rawData?.rows?.length ?? 0,
    })));
  }, [datasets, projectPid]);

  useEffect(() => {
    if (!hydratedRef.current || !activeId) return;
    saveProject(projectPid, { activeDatasetId: activeId }).catch(() => {});
    onActiveDatasetChange?.(activeId);
  }, [activeId, projectPid]);

  // Register datasets in sessionState whenever `datasets` changes.
  // Uses registeredIds ref so each dataset is only dispatched once (idempotent
  // guard), but newly added datasets (from handleLoadFile, handleSaveSubset, etc.)
  // are always caught — no stale-closure risk from useCallback [] deps.
  useEffect(() => {
    if (!dispatch) return;
    datasets.forEach(d => {
      if (!d.rawData || registeredIds.current.has(d.id)) return;
      registeredIds.current.add(d.id);
      registerDataset(dispatch, {
        id:       d.id,
        name:     d.name ?? d.filename,
        source:   "loaded",
        // Use full DuckDB row count when available, fall back to extracted length
        rowCount: d.rawData._duckdb?.rowCount ?? d.rawData.rows?.length    ?? 0,
        colCount: d.rawData.headers?.length ?? 0,
        headers:  d.rawData.headers         ?? [],
        crs:      datasetCrs(d),
        loadOpts: d.rawData._loadOpts ?? null,
      });
    });
  }, [datasets, dispatch]);

  // Expose slim dataset list to parent (for Modeling Lab dataset picker)
  useEffect(() => {
    onDatasetsChange?.(datasets.map(d => ({
      id:       d.id,
      filename: d.filename,
      name:     d.name ?? d.filename,       // user-given display name drives df_<name> in scripts
      rows:     d.rawData?.rows    ?? [],   // preview only for DuckDB-backed datasets
      headers:  d.rawData?.headers ?? [],
      crs:      datasetCrs(d),
      loadOpts: d.rawData?._loadOpts ?? null,
      // Full-table pointer — consumers MUST compute off this (SQL / extractAllRows),
      // never off `rows`, which is a 500-row preview for large DuckDB datasets.
      _duckdb:  d.rawData?._duckdb  ?? null,
    })));
  }, [datasets]);

  // Sync external activeDatasetId (from DatasetManager click) into local activeId
  useEffect(() => {
    if (activeDatasetId && datasets.some(d => d.id === activeDatasetId)) {
      setActiveId(activeDatasetId);
    }
  }, [activeDatasetId]);

  const activeDs       = datasets.find(d => d.id === activeId) || datasets[0];
  // Other datasets — passed to WranglingModule for join/append context.
  // useMemo so the array reference is stable across re-renders (prevents
  // context → rows → onReady render loop in WranglingModule).
  const otherDatasets  = useMemo(
    () => datasets.filter(d => d.id !== activeId),
    [datasets, activeId],
  );

  // Add a single already-parsed dataset to the session. Shared by single-file
  // and multi-file load paths so they stay in sync.
  const addParsedDataset = useCallback((filename, parsed) => {
    parsed = ensureRowIds(parsed);
    const id    = genId();
    const entry = { id, filename, rawData: parsed, crs: parsed._crs ?? null };
    setDatasets(prev => [...prev, entry]);
    setActiveId(id);
    saveRawData(id, parsed);
    if (dispatch) {
      registerDataset(dispatch, {
        id:       entry.id,
        name:     filename,
        source:   "loaded",
        rowCount: parsed.rows.length,
        colCount: parsed.headers.length,
        headers:  parsed.headers,
        crs:      parsed._crs ?? null,
        loadOpts: parsed._loadOpts ?? null,
      });
    }
    appendLog({
      module: "data", opType: "dataset_load", datasetId: id,
      params: { filename, loadOpts: parsed._loadOpts ?? null, rows: parsed.rows.length, cols: parsed.headers.length },
      label:  `Loaded ${filename} (${parsed.rows.length.toLocaleString()} × ${parsed.headers.length})`,
    });
    return id;
  }, [dispatch, appendLog]);

  const handleLoadFile = useCallback(async (file) => {
    setLoading(true);
    setLoadErr("");
    try {
      let parsed = await parseFile(file);
      if (!parsed || !parsed.rows.length) {
        throw new Error("Could not parse file — no rows found. Check the file format.");
      }
      if (parsed._duckdb?.truncated) {
        setLoadErr(
          `Large file: loaded first 2,000,000 of ${parsed._duckdb.rowCount.toLocaleString()} rows via DuckDB.`
        );
      }
      addParsedDataset(file.name, parsed);
    } catch (e) {
      setLoadErr("Parse error: " + (e?.message || "unknown"));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [addParsedDataset]);

  // Multi-file path — groups shapefile siblings into single datasets, loads
  // all valid entries, and reports per-file errors without throwing.
  const handleLoadFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length === 1) { await handleLoadFile(files[0]); return; }
    setLoading(true);
    setLoadErr("");
    try {
      const results = await parseFiles(files);
      const ok     = results.filter(r => r.parsed);
      const errors = results.filter(r => r.error);
      for (const r of ok) addParsedDataset(r.filename, r.parsed);
      if (errors.length) {
        setLoadErr(`${errors.length} file(s) failed: ` + errors.map(e => `${e.filename} (${e.error})`).join("; "));
      } else if (ok.length > 1) {
        setLoadErr(`Loaded ${ok.length} datasets.`);
      }
    } catch (e) {
      setLoadErr("Parse error: " + (e?.message || "unknown"));
    } finally {
      setLoading(false);
    }
  }, [addParsedDataset, handleLoadFile]);

  const handleRemove = useCallback((id) => {
    setDatasets(prev => {
      const ds = prev.find(d => d.id === id);
      const key = ds?.rawData?._duckdb?.opfsCacheKey;
      if (key) deleteCacheEntry(key); // fire-and-forget OPFS cleanup
      deleteRawData(id);              // free durable rows for the removed dataset
      const next = prev.filter(d => d.id !== id);
      setActiveId(cur => cur === id ? (next[0]?.id ?? null) : cur);
      return next;
    });
  }, []);

  // Save a derived dataset (pipeline output or summarize result) into the manager.
  // Appears immediately in the sidebar with its own empty pipeline.
  const handleSaveSubset = useCallback((name, rows, headers, recipe = null, options = null) => {
    const parentId = activeId;
    const id    = options?.id ?? genId();
    // ensureRowIds: assign __ri so cell editing (patch step) works for
    // simulated / API-loaded / derived datasets, not just file uploads
    const rawData = ensureRowIds({ rows, headers });
    // Durably persist to IndexedDB (100MB cap) so large derived datasets — e.g.
    // spatial Aggregate-to-Grid / Spatial Join outputs carrying WKT geometry —
    // survive a reload even when they exceed the sessionStorage size budget.
    saveRawData(id, rawData);
    const entry = {
      id,
      filename: name,
      rawData,
      origin:   parentId,   // informational — which dataset it came from
    };
    setDatasets(prev => [...prev, entry]);
    setActiveId(id);        // switch to the new subset immediately
    if (dispatch) {
      registerDataset(dispatch, {
        id:       id,
        name:     name,
        source:   "derived",
        rowCount: rows.length,
        colCount: headers.length,
        headers:  headers,
      });
      if (recipe && parentId) {
        dispatch({
          type: "ADD_GLOBAL_STEP",
          step: {
            id: `G_${Date.now()}`,
            opType: "derive",
            leftDatasetId: id,
            rightDatasetId: parentId,
            params: { recipe },
          },
        });
      }
    }
    appendLog({
      module: "data", opType: "dataset_derive", datasetId: id,
      reproducible: !!recipe,
      params: { name, originId: parentId, rows: rows.length, cols: headers.length, ...(recipe ? { recipe } : {}) },
      label:  `Derived dataset ${name} (${rows.length.toLocaleString()} × ${headers.length})`,
    });
    return id;
  }, [activeId, dispatch, appendLog]);

  // Expose imperative handles so DataTab can add datasets without prop-drilling.
  // Must come after handleLoadFile and handleSaveSubset are defined.
  useImperativeHandle(ref, () => ({
    addFile:          handleLoadFile,
    addFiles:         handleLoadFiles,
    addParsed:        addParsedDataset,
    addApiData:       (fname, rows, headers, recipe = null, options = null) => handleSaveSubset(fname, rows, headers, recipe, options),
    switchToDataset:  (id) => setActiveId(id),
    // Rename a dataset (display name only — the original filename is kept for
    // load calls). The name drives the df_<name> identifier in replication
    // scripts, DatasetManager labels, and the AI session snapshot.
    renameDataset:    (id, newName) => {
      const name = String(newName ?? "").trim();
      if (!name) return;
      setDatasets(prev => prev.map(d => d.id === id ? { ...d, name } : d));
      if (dispatch) dispatch({ type: "UPDATE_DATASET_META", id, patch: { name } });
    },
    removeDataset:    (id) => {
      setDatasets(prev => {
        const ds = prev.find(d => d.id === id);
        const key = ds?.rawData?._duckdb?.opfsCacheKey;
        if (key) deleteCacheEntry(key);
        deleteRawData(id);
        const next = prev.filter(d => d.id !== id);
        setActiveId(cur => cur === id ? (next[0]?.id ?? null) : cur);
        return next;
      });
      if (dispatch) dispatch({ type: "REMOVE_DATASET", id }); // sync sessionState
    },
    removeDatasetLocal: (id) => {
      // Called by DatasetManager which already dispatched to sessionState
      setDatasets(prev => {
        const ds = prev.find(d => d.id === id);
        const key = ds?.rawData?._duckdb?.opfsCacheKey;
        if (key) deleteCacheEntry(key);
        deleteRawData(id);
        const next = prev.filter(d => d.id !== id);
        setActiveId(cur => cur === id ? (next[0]?.id ?? null) : cur);
        return next;
      });
    },
    patchDatasetColumns: (id, newRows, newCols) => {
      // Adds new columns to an existing dataset in-place — no new dataset created.
      setDatasets(prev => prev.map(d => {
        if (d.id !== id) return d;
        const allHeaders = [...new Set([...(d.rawData?.headers ?? []), ...newCols])];
        // ensureRowIds: spatial joins / merges may produce rows without __ri;
        // assign them so edit-cells works post-merge
        const updated = { ...d, rawData: ensureRowIds({ rows: newRows, headers: allHeaders }) };
        return updated;
      }));
      if (dispatch) dispatch({
        type: "UPDATE_DATASET_META", id,
        patch: { colCount: undefined }, // will be recalculated via onDatasetsChange
      });
    },
    // Called by DataViewer when a cell is edited — dispatches a patch step into
    // the active WranglingModule's pipeline via the shared ref
    addPatchStep: (ri, col, value) => {
      wranglingAddStepRef.current?.({
        type: "patch", internal: true, ri, col, value,
        desc: `edit row ${ri + 1} · ${col} → ${value ?? "NA"}`,
      });
    },
    // Called by DataViewer "Fill column" panel — dispatches an ai_tr step
    addFillColumnStep: (col, op, text) => {
      let js;
      const escaped = JSON.stringify(text);
      if (op === "set")     js = `v => ${escaped}`;
      else if (op === "append")  js = `v => v == null ? ${escaped} : String(v) + ${escaped}`;
      else if (op === "prepend") js = `v => v == null ? ${escaped} : ${escaped} + String(v)`;
      else js = `v => ${escaped}`;
      const opLabel = op === "set" ? "set" : op === "append" ? "append to" : "prepend to";
      wranglingAddStepRef.current?.({
        type: "ai_tr", col, js,
        desc: `Fill: ${opLabel} "${col}" → ${text.length > 40 ? text.slice(0, 40) + "…" : text}`,
      });
    },
    addColumnStep: (nn, fill, dtype) => {
      wranglingAddStepRef.current?.({
        type: "add_column", nn, fill, dtype,
        desc: `add column ${nn}`,
      });
    },
    addRowStep: (values = {}, count = 1) => {
      const seq = ++addRowSeqRef.current;
      wranglingAddStepRef.current?.({
        type: "add_row", values, count, _seq: seq,
        desc: `add ${count} row(s)`,
      });
    },
    addSetWhereStep: (col, where, action, value) => {
      wranglingAddStepRef.current?.({
        type: "set_where", col, where, action, value,
        desc: `set ${col} ${action === "clear" ? "= NA" : `= ${value}`} where ${where?.col} ${where?.op} ${where?.value}`,
      });
    },
    addReplaceStep: (col, match, replaceWith, nn) => {
      wranglingAddStepRef.current?.({
        type: "replace", col, match, replaceWith, nn: nn || "",
        desc: `replace in ${col}: "${match?.find}" -> "${replaceWith}"`,
      });
    },
    addStrSpliceStep: (col, position, mode, text, count, nn) => {
      wranglingAddStepRef.current?.({
        type: "str_splice", col, position, mode, text, count, nn: nn || "",
        desc: `${mode} chars in ${col} at ${position}`,
      });
    },
    // Called by ModelingTab's ExtractPanel — splices a model-derived column
    // (fitted values, residuals, first-stage fitted, SC gap) into the active
    // dataset's pipeline as an inject_column step (two-pass estimation).
    addInjectColumnStep: (colName, values) => {
      wranglingAddStepRef.current?.({
        type: "inject_column", colName, values: Array.from(values),
        desc: `inject "${colName}" (${values.length} values)`,
      });
    },
  }), [handleLoadFile, handleLoadFiles, addParsedDataset, handleSaveSubset]);

  return (
    <div style={{
      display: "flex", height: "100%", minHeight: 0,
      background: C.bg, overflow: "hidden",
    }}>
      {/* ── Main panel: WranglingModule for active dataset ── */}
      {/* DatasetSidebar removed — dataset management lives in WorkspaceBar DatasetManager */}
      {activeDs ? (
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {/*
            key={activeDs.id} ensures a fresh WranglingModule instance per dataset.
            This gives each dataset independent pipeline state and tab position.
            allDatasets = all OTHER datasets (context for join/append steps).
          */}
          <WranglingModule
            key={activeDs.id}
            rawData={activeDs.rawData}
            filename={activeDs.filename}
            onComplete={onComplete}
            onReady={r => onOutputReady?.(r, activeDs.id)}
            pid={activeDs.id}
            projectPid={projectPid}
            allDatasets={otherDatasets}
            onSaveSubset={handleSaveSubset}
            addStepRef={wranglingAddStepRef}
            assistantPrefill={assistantPrefill}
            onConsumePrefill={onConsumePrefill}
          />
        </div>
      ) : (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, textAlign: "center", padding: "2rem",
        }}>
          No datasets in this project yet.<br/>
          Go to the <span style={{ color: C.teal }}>Data</span> tab to load one.
        </div>
      )}

      {/* ── World Bank fetcher modal ── */}
      {wbOpen && (
        <WorldBankFetcher
          onLoad={(fname, rows, headers) => handleSaveSubset(fname, rows, headers)}
          onClose={() => setWbOpen(false)}
        />
      )}

      {/* ── OECD fetcher modal ── */}
      {oecdOpen && (
        <OECDFetcher
          onLoad={(fname, rows, headers) => handleSaveSubset(fname, rows, headers)}
          onClose={() => setOecdOpen(false)}
        />
      )}
    </div>
  );
});

export default DataStudio;
