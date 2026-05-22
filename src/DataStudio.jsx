// ─── ECON STUDIO · DataStudio.jsx ────────────────────────────────────────────
// Multi-dataset manager.
// Manages a list of loaded datasets, exposes them to WranglingModule
// for JOIN / APPEND operations, and renders the active dataset's pipeline editor.
//
// External interface — drop-in replacement for WranglingModule:
//   rawData    {headers, rows}  – initial (primary) dataset, pre-parsed
//   filename   {string}
//   onComplete {fn}             – (cleanedData) => void — same shape as before
//   pid        {string}         – project ID for the primary dataset
//
// Additional datasets loaded here are available in WranglingModule's Merge tab.
// They are kept in component state (not persisted) — equivalent to R's
// "you must re-run your script to reload data" behavior.

import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { useTheme } from "./ThemeContext.jsx";
import WranglingModule from "./WranglingModule.jsx";
import { saveRawData } from "./services/Persistence/indexedDB.js";
import WorldBankFetcher from "./components/wrangling/WorldBankFetcher.jsx";
import OECDFetcher     from "./components/wrangling/OECDFetcher.jsx";
import { useSessionDispatch, registerDataset } from "./services/session/sessionState.jsx";
import { deleteCacheEntry } from "./services/data/parquetCache.js";

// ─── THEME ────────────────────────────────────────────────────────────────────
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

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
// Excel parser — loads SheetJS from CDN (same pattern as App.jsx, avoids Vite bare-module error)
async function parseExcel(file) {
  const { utils, read } = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  const buf = await file.arrayBuffer();
  const wb  = read(buf, { type: "array", cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Excel file has no sheets.");
  const data = utils.sheet_to_json(ws, { defval: null, raw: false });
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

async function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (["csv", "txt"].includes(ext)) {
    if (file.size > 10 * 1024 * 1024) {
      const { loadLargeCSV } = await import("./services/data/duckdb.js");
      return loadLargeCSV(file);
    }
    const text = await file.text();
    return parseCSV(text, detectDelimiter(text));
  }
  if (ext === "tsv") {
    if (file.size > 10 * 1024 * 1024) {
      const { loadLargeCSV } = await import("./services/data/duckdb.js");
      return loadLargeCSV(file);
    }
    const text = await file.text();
    return parseCSV(text, "\t");
  }
  if (["xlsx", "xls"].includes(ext)) {
    return parseExcel(file);
  }
  if (ext === "dta") {
    const { parseStata } = await import("./services/data/parsers/stata.js");
    const buf = await file.arrayBuffer();
    return parseStata(buf);
  }
  if (ext === "rds") {
    const { parseRDS } = await import("./services/data/parsers/rds.js");
    const buf = await file.arrayBuffer();
    return parseRDS(buf);
  }
  if (ext === "parquet") {
    const { loadParquet } = await import("./services/data/duckdb.js");
    return loadParquet(file);
  }
  if (ext === "dbf") {
    const { parseShapefile } = await import("./services/data/parsers/shapefile.js");
    const buf = await file.arrayBuffer();
    return parseShapefile(buf, null);
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
    return parseShapefile(dbfBuf, shpBuf, prjText);
  }
  if (ext === "shp") {
    const { parseSHPOnly } = await import("./services/data/parsers/shapefile.js");
    const buf = await file.arrayBuffer();
    return parseSHPOnly(buf);
  }
  // Unknown extension: try CSV as fallback with auto-detected delimiter
  try {
    const text = await file.text();
    return parseCSV(text, detectDelimiter(text));
  } catch { return null; }
}

// ─── DATASET SIDEBAR ──────────────────────────────────────────────────────────
function DatasetSidebar({ datasets, activeId, onActivate, onRemove, onLoadFile, onFetchWorldBank, onFetchOECD, loadErr, loading }) {
  const { C } = useTheme();
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
        <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase", fontFamily: mono, marginBottom: 4 }}>
          Dataset Manager
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
          {datasets.length} dataset{datasets.length !== 1 ? "s" : ""} loaded
        </div>
      </div>

      {/* ── Dataset list ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.3rem 0" }}>
        {datasets.map((ds, idx) => {
          const isActive = ds.id === activeId;
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
                    fontSize: 8, padding: "1px 5px",
                    border: `1px solid ${isActive ? C.teal : C.border2}`,
                    color: isActive ? C.teal : C.textMuted,
                    borderRadius: 2, fontFamily: mono, flexShrink: 0,
                    letterSpacing: "0.08em",
                  }}>
                    D{idx + 1}
                  </span>
                  {isActive && (
                    <span style={{ fontSize: 8, color: C.teal, fontFamily: mono }}>● active</span>
                  )}
                  {idx === 0 && !isActive && (
                    <span style={{ fontSize: 8, color: C.textMuted, fontFamily: mono }}>primary</span>
                  )}
                </div>

                {/* Filename — truncated */}
                <div style={{
                  fontSize: 11, color: isActive ? C.text : C.textDim,
                  fontFamily: mono, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                  lineHeight: 1.4, marginBottom: 2,
                }}>
                  {ds.filename}
                </div>

                {/* Dimensions */}
                <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>
                  {(ds.rawData._duckdb?.rowCount ?? ds.rawData.rows.length).toLocaleString()} rows ×{" "}
                  {ds.rawData.headers.length} cols
                  {ds.rawData._duckdb && (
                    <span style={{ marginLeft: 5, color: C.teal, letterSpacing: "0.05em" }}>
                      {ds.rawData._duckdb.cached ? "· cached" : "· duckdb"}
                    </span>
                  )}
                </div>
              </div>

              {/* Remove — only for non-primary datasets */}
              {idx > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); onRemove(ds.id); }}
                  title="Remove dataset"
                  style={{
                    background: "transparent", border: "none",
                    color: C.textMuted, cursor: "pointer",
                    fontSize: 14, padding: "0 2px", lineHeight: 1,
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
          accept=".csv,.tsv,.xlsx,.xls,.txt,.dta,.rds,.dbf,.shp,.prj,.shx,.cpg,.parquet,.zip"
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
            fontFamily: mono, fontSize: 10,
            transition: "all 0.12s",
          }}
          onMouseEnter={e => { if (!loading) { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; } }}
          onMouseLeave={e => { if (!loading && !dragOver) { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; } }}
        >
          {loading ? "Parsing…" : dragOver ? "Drop to load" : "+ Load dataset"}
        </button>

        {/* Error/info message */}
        {loadErr && (
          <div style={{ fontSize: 9, color: loadErr.startsWith("Large file") ? C.gold : C.red, fontFamily: mono, marginTop: 6, lineHeight: 1.5 }}>
            {loadErr}
          </div>
        )}

        {/* World Bank fetcher button */}
        <button
          onClick={onFetchWorldBank}
          style={{ width:"100%", marginTop:6, padding:"0.42rem 0.5rem", background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily:mono, fontSize:10, transition:"all 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
        >↓ World Bank data</button>

        {/* OECD fetcher button */}
        <button
          onClick={onFetchOECD}
          style={{ width:"100%", marginTop:4, padding:"0.42rem 0.5rem", background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily:mono, fontSize:10, transition:"all 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.blue; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
        >↓ OECD data</button>

        {/* Format hint */}
        <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginTop: 6, lineHeight: 1.6 }}>
          CSV · TSV · XLSX · DTA · RDS · DBF · Parquet · drag & drop supported
          <br/>
          Loaded datasets available for JOIN / APPEND in the Merge tab.
        </div>
      </div>
    </div>
  );
}

// ─── SESSION STORAGE — secondary datasets persist across navigation ───────────
// Scoped by pid so datasets from project A never appear in project B.
const SS_PREFIX = "econ_studio_secondary_ds_";
function ssKey(pid) { return SS_PREFIX + pid; }
function ssRead(pid) {
  try { return JSON.parse(sessionStorage.getItem(ssKey(pid)) || "[]"); } catch { return []; }
}
function ssWrite(pid, secondaryDatasets) {
  try {
    const s = JSON.stringify(secondaryDatasets);
    if (s.length < 8 * 1024 * 1024) sessionStorage.setItem(ssKey(pid), s);
  } catch { /* quota exceeded — non-fatal */ }
}
function ssClear(pid) {
  try { sessionStorage.removeItem(ssKey(pid)); } catch {}
}

// ─── DATA STUDIO ROOT ─────────────────────────────────────────────────────────
// Assign stable __ri row IDs if not already present.
// __ri is used by the patch pipeline step for cell editing (runner.js).
function ensureRowIds(data) {
  if (!data?.rows?.length || data.rows[0]?.__ri !== undefined) return data;
  return { ...data, rows: data.rows.map((r, i) => ({ __ri: i, ...r })) };
}

const DataStudio = forwardRef(function DataStudio({ rawData, filename, onComplete, onOutputReady, pid, onDatasetsChange, activeDatasetId }, ref) {
  const { C } = useTheme();
  const primaryId = pid || genId();
  const dispatch = useSessionDispatch();

  // Ref exposed to WranglingModule so DataViewer can dispatch patch steps
  const wranglingAddStepRef = useRef(null);

  // Track which dataset IDs have already been registered in sessionState.
  // Prevents duplicate dispatches while ensuring every new dataset gets registered
  // regardless of which code path added it (handleLoadFile, handleSaveSubset, etc).
  const registeredIds = useRef(new Set());

  const [datasets, setDatasets] = useState(() => {
    // Secondary datasets scoped to this project's pid — no cross-project leakage
    const secondary = ssRead(primaryId);
    return [
      { id: primaryId, filename: filename || "dataset.csv", rawData: ensureRowIds(rawData) },
      ...secondary,
    ];
  });
  const [activeId, setActiveId]   = useState(primaryId);
  const [loading, setLoading]     = useState(false);
  const [loadErr, setLoadErr]     = useState("");
  const [wbOpen,   setWbOpen]     = useState(false);
  const [oecdOpen, setOecdOpen]   = useState(false);

  // ── Persist primary raw data on first mount ────────────────────────────────
  // This ensures "Open project" works without re-uploading.
  useEffect(() => {
    if (rawData && primaryId) {
      saveRawData(primaryId, rawData);
    }
  }, [primaryId]); // only on mount — rawData ref won't change for same project

  // ── Persist primary raw data on first mount ────────────────────────────────
  // This ensures "Open project" works without re-uploading.
  useEffect(() => {
    if (rawData && primaryId) {
      saveRawData(primaryId, rawData);
    }
  }, [primaryId]); // only on mount — rawData ref won't change for same project

  // Keep primary rawData in sync if parent re-loads a new file.
  // If rawData actually changed (new file), clear secondary datasets — they
  // belonged to the previous project and would produce stale join results.
  const prevRawDataRef = useRef(rawData);
  useEffect(() => {
    const newFile = prevRawDataRef.current !== rawData;
    prevRawDataRef.current = rawData;
    if (newFile) {
      // New primary file loaded — drop secondary datasets and clear sessionStorage
      setDatasets([{ id: primaryId, filename: filename || "dataset.csv", rawData: ensureRowIds(rawData) }]);
      setActiveId(primaryId);
      ssClear(primaryId);
    } else {
      // Same file, just sync filename (rawData ref unchanged — keep ensureRowIds-processed version)
      setDatasets(prev => prev.map(ds =>
        ds.id === primaryId ? { ...ds, filename: filename || ds.filename } : ds
      ));
    }
  }, [rawData, filename]);

  // Persist secondary datasets to sessionStorage whenever the list changes
  useEffect(() => {
    const secondary = datasets.filter(d => d.id !== primaryId);
    ssWrite(primaryId, secondary);
  }, [datasets, primaryId]);

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
        name:     d.filename,
        source:   "loaded",
        // Use full DuckDB row count when available, fall back to extracted length
        rowCount: d.rawData._duckdb?.rowCount ?? d.rawData.rows?.length    ?? 0,
        colCount: d.rawData.headers?.length ?? 0,
        headers:  d.rawData.headers         ?? [],
      });
    });
  }, [datasets, dispatch]);

  // Expose slim dataset list to parent (for Modeling Lab dataset picker)
  useEffect(() => {
    onDatasetsChange?.(datasets.map(d => ({
      id:       d.id,
      filename: d.filename,
      rows:     d.rawData?.rows    ?? [],
      headers:  d.rawData?.headers ?? [],
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
      });
    }
    return id;
  }, [dispatch]);

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
    if (id === primaryId) return; // primary dataset is protected
    setDatasets(prev => {
      const ds = prev.find(d => d.id === id);
      const key = ds?.rawData?._duckdb?.opfsCacheKey;
      if (key) deleteCacheEntry(key); // fire-and-forget OPFS cleanup
      return prev.filter(d => d.id !== id);
    });
    setActiveId(prev => prev === id ? primaryId : prev);
  }, [primaryId]);

  // Save a derived dataset (pipeline output or summarize result) into the manager.
  // Appears immediately in the sidebar with its own empty pipeline.
  const handleSaveSubset = useCallback((name, rows, headers) => {
    const id    = genId();
    // ensureRowIds: assign __ri so cell editing (patch step) works for
    // simulated / API-loaded / derived datasets, not just file uploads
    const rawData = ensureRowIds({ rows, headers });
    const entry = {
      id,
      filename: name,
      rawData,
      origin:   activeId,   // informational — which dataset it came from
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
    }
    return id;
  }, [activeId, dispatch]);

  // Expose imperative handles so DataTab can add datasets without prop-drilling.
  // Must come after handleLoadFile and handleSaveSubset are defined.
  useImperativeHandle(ref, () => ({
    addFile:          handleLoadFile,
    addFiles:         handleLoadFiles,
    addParsed:        addParsedDataset,
    addApiData:       (fname, rows, headers) => handleSaveSubset(fname, rows, headers),
    switchToDataset:  (id) => setActiveId(id),
    removeDataset:    (id) => {
      if (id === primaryId) return; // never remove primary
      setDatasets(prev => {
        const ds = prev.find(d => d.id === id);
        const key = ds?.rawData?._duckdb?.opfsCacheKey;
        if (key) deleteCacheEntry(key);
        return prev.filter(d => d.id !== id);
      });
      setActiveId(prev => prev === id ? primaryId : prev);
      if (dispatch) dispatch({ type: "REMOVE_DATASET", id }); // sync sessionState
    },
    removeDatasetLocal: (id) => {
      // Called by DatasetManager which already dispatched to sessionState
      if (id === primaryId) return;
      setDatasets(prev => {
        const ds = prev.find(d => d.id === id);
        const key = ds?.rawData?._duckdb?.opfsCacheKey;
        if (key) deleteCacheEntry(key);
        return prev.filter(d => d.id !== id);
      });
      setActiveId(prev => prev === id ? primaryId : prev);
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
  }), [handleLoadFile, handleLoadFiles, addParsedDataset, handleSaveSubset, primaryId]);

  return (
    <div style={{
      display: "flex", height: "100%", minHeight: 0,
      background: C.bg, overflow: "hidden",
    }}>
      {/* ── Main panel: WranglingModule for active dataset ── */}
      {/* DatasetSidebar removed — dataset management lives in WorkspaceBar DatasetManager */}
      {activeDs && (
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
            allDatasets={otherDatasets}
            onSaveSubset={handleSaveSubset}
            addStepRef={wranglingAddStepRef}
          />
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
