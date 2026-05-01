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
import { saveRawData } from "./services/persistence/indexedDB.js";
import WorldBankFetcher from "./components/wrangling/WorldBankFetcher.jsx";
import OECDFetcher     from "./components/wrangling/OECDFetcher.jsx";
import { useSessionDispatch, registerDataset } from "./services/session/sessionState.jsx";

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
  const NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|\.|\s*)$/i;

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
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 5);
  if (!lines.length) return ",";
  let tabs = 0, commas = 0, semis = 0, pipes = 0;
  lines.forEach(l => {
    tabs  += (l.match(/\t/g)  || []).length;
    commas += (l.match(/,/g)  || []).length;
    semis  += (l.match(/;/g)  || []).length;
    pipes  += (l.match(/\|/g) || []).length;
  });
  if (tabs  > commas && tabs  > semis && tabs  > pipes) return "\t";
  if (semis > commas && semis > pipes && semis > tabs)  return ";";
  if (pipes > commas && pipes > semis && pipes > tabs)  return "|";
  return ",";
}

// ─── FILE DISPATCHER ──────────────────────────────────────────────────────────
async function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (["csv", "txt"].includes(ext)) {
    const text = await file.text();
    return parseCSV(text, detectDelimiter(text));
  }
  if (ext === "tsv") {
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
  if (ext === "shp") {
    // User uploaded the .shp directly — we can only extract geometry without a .dbf.
    // Advise them to upload the .dbf instead for the attribute table.
    throw new Error(
      "Upload the .dbf file (not .shp) to load shapefile attributes. " +
      "The .dbf contains the data table. The .shp geometry will be omitted."
    );
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
    const file = e.dataTransfer.files[0];
    if (file) onLoadFile(file);
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
                  {ds.rawData.rows.length.toLocaleString()} rows ×{" "}
                  {ds.rawData.headers.length} cols
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
          accept=".csv,.tsv,.xlsx,.xls,.txt,.dta,.rds,.dbf,.parquet"
          style={{ display: "none" }}
          onChange={e => { if (e.target.files[0]) onLoadFile(e.target.files[0]); e.target.value = ""; }}
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

        {/* Error message */}
        {loadErr && (
          <div style={{ fontSize: 9, color: C.red, fontFamily: mono, marginTop: 6, lineHeight: 1.5 }}>
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
const DataStudio = forwardRef(function DataStudio({ rawData, filename, onComplete, onOutputReady, pid, onDatasetsChange, activeDatasetId }, ref) {
  const { C } = useTheme();
  const primaryId = pid || genId();
  const dispatch = useSessionDispatch();

  const [datasets, setDatasets] = useState(() => {
    // Secondary datasets scoped to this project's pid — no cross-project leakage
    const secondary = ssRead(primaryId);
    return [
      { id: primaryId, filename: filename || "dataset.csv", rawData },
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
      setDatasets([{ id: primaryId, filename: filename || "dataset.csv", rawData }]);
      setActiveId(primaryId);
      ssClear(primaryId);
    } else {
      // Same file, just sync props (e.g. filename rename)
      setDatasets(prev => prev.map(ds =>
        ds.id === primaryId ? { ...ds, rawData, filename: filename || ds.filename } : ds
      ));
    }
  }, [rawData, filename]);

  // Persist secondary datasets to sessionStorage whenever the list changes
  useEffect(() => {
    const secondary = datasets.filter(d => d.id !== primaryId);
    ssWrite(primaryId, secondary);
  }, [datasets, primaryId]);

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

  const handleLoadFile = useCallback(async (file) => {
    setLoading(true);
    setLoadErr("");
    try {
      const parsed = await parseFile(file);
      if (!parsed || !parsed.rows.length) {
        setLoadErr("Could not parse file. Check format (CSV, TSV, XLSX, Parquet).");
        return;
      }
      if (parsed._duckdb?.truncated) {
        setLoadErr(
          `Large file: loaded first 500,000 of ${parsed._duckdb.rowCount.toLocaleString()} rows via DuckDB.`
        );
      }
      const id    = genId();
      const entry = { id, filename: file.name, rawData: parsed };
      setDatasets(prev => [...prev, entry]);
      setActiveId(id);
      // Persist so this secondary dataset survives a reload if promoted to primary
      saveRawData(id, parsed);
      if (dispatch) {
        registerDataset(dispatch, {
          id:       entry.id,
          name:     file.name,
          source:   "loaded",
          rowCount: parsed.rows.length,
          colCount: parsed.headers.length,
          headers:  parsed.headers,
        });
      }
    } catch (e) {
      setLoadErr("Parse error: " + (e?.message || "unknown"));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRemove = useCallback((id) => {
    if (id === primaryId) return; // primary dataset is protected
    setDatasets(prev => prev.filter(d => d.id !== id));
    // If we were viewing the removed dataset, fall back to primary
    setActiveId(prev => prev === id ? primaryId : prev);
  }, [primaryId]);

  // Save a derived dataset (pipeline output or summarize result) into the manager.
  // Appears immediately in the sidebar with its own empty pipeline.
  const handleSaveSubset = useCallback((name, rows, headers) => {
    const id    = genId();
    const entry = {
      id,
      filename: name,
      rawData:  { rows, headers },
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
  }, [activeId, dispatch]);

  // Expose imperative handles so DataTab can add datasets without prop-drilling.
  // Must come after handleLoadFile and handleSaveSubset are defined.
  useImperativeHandle(ref, () => ({
    addFile:          handleLoadFile,
    addApiData:       (fname, rows, headers) => handleSaveSubset(fname, rows, headers),
    switchToDataset:  (id) => setActiveId(id),
    removeDataset:    (id) => {
      if (id === primaryId) return; // never remove primary
      setDatasets(prev => prev.filter(d => d.id !== id));
      setActiveId(prev => prev === id ? primaryId : prev);
    },
  }), [handleLoadFile, handleSaveSubset, primaryId]);

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
