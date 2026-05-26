// ─── ECON STUDIO · services/export/loadLine.js ─────────────────────────────
// Generates the correct "load data" line for R / Python / Stata replication
// scripts, honoring `dataLoadOpts` captured at parse time by DataStudio.
//
// loadOpts shape (from sessionState.jsx):
//   { format: 'csv'|'tsv'|'excel'|'stata'|'rds'|'parquet'|'shapefile-*',
//     delimiter?, encoding?, sheetName?, engine? }
//
// If loadOpts is null/undefined, falls back to extension-based detection so
// existing call sites still work without modification.

// ─── helpers ─────────────────────────────────────────────────────────────────
function rStr(s) {
  return `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function pyStr(s) {
  return JSON.stringify(String(s ?? ""));
}
function stataPath(s) {
  return String(s ?? "").replace(/\\/g, "/");
}

function inferFormat(filename, loadOpts) {
  if (loadOpts?.format) return loadOpts.format;
  const ext = (filename || "").split(".").pop()?.toLowerCase();
  if (ext === "csv")  return "csv";
  if (ext === "tsv")  return "tsv";
  if (ext === "xlsx" || ext === "xls") return "excel";
  if (ext === "dta")  return "stata";
  if (ext === "rds")  return "rds";
  if (ext === "parquet") return "parquet";
  if (ext === "dbf")  return "shapefile-dbf";
  if (ext === "shp")  return "shapefile-shp";
  if (ext === "zip")  return "shapefile-zip";
  return "csv";
}

// ─── R ───────────────────────────────────────────────────────────────────────
export function buildRLoadLine(filename, loadOpts = null) {
  const fmt = inferFormat(filename, loadOpts);
  const f   = rStr(filename);
  switch (fmt) {
    case "csv": {
      const delim = loadOpts?.delimiter && loadOpts.delimiter !== "auto" && loadOpts.delimiter !== ","
        ? loadOpts.delimiter : null;
      const enc   = loadOpts?.encoding && loadOpts.encoding !== "utf-8" ? loadOpts.encoding : null;
      if (delim || enc) {
        const args = [f];
        if (delim) args.push(`delim = ${rStr(delim)}`);
        if (enc)   args.push(`locale = readr::locale(encoding = ${rStr(enc)})`);
        return `df <- readr::read_delim(${args.join(", ")})`;
      }
      return `df <- readr::read_csv(${f})`;
    }
    case "tsv":
      return `df <- readr::read_tsv(${f})`;
    case "excel": {
      const sheet = loadOpts?.sheetName ? `, sheet = ${rStr(loadOpts.sheetName)}` : "";
      return `df <- readxl::read_excel(${f}${sheet})`;
    }
    case "stata":
      return `df <- haven::read_dta(${f})`;
    case "rds":
      return `df <- readRDS(${f})`;
    case "parquet":
      return `df <- arrow::read_parquet(${f})`;
    case "shapefile-shp":
    case "shapefile-zip":
      return `df <- sf::st_read(${f})`;
    case "shapefile-dbf":
      return `df <- foreign::read.dbf(${f})`;
    default:
      return `df <- readr::read_csv(${f})  # adjust for your format`;
  }
}

// ─── Python ──────────────────────────────────────────────────────────────────
export function buildPyLoadLine(filename, loadOpts = null) {
  const fmt = inferFormat(filename, loadOpts);
  const f   = pyStr(filename);
  switch (fmt) {
    case "csv": {
      const args = [f];
      if (loadOpts?.delimiter && loadOpts.delimiter !== "auto" && loadOpts.delimiter !== ",") {
        args.push(`sep=${pyStr(loadOpts.delimiter)}`);
      }
      if (loadOpts?.encoding && loadOpts.encoding !== "utf-8") {
        args.push(`encoding=${pyStr(loadOpts.encoding)}`);
      }
      return `df = pd.read_csv(${args.join(", ")})`;
    }
    case "tsv":
      return `df = pd.read_csv(${f}, sep="\\t")`;
    case "excel": {
      const sheet = loadOpts?.sheetName ? `, sheet_name=${pyStr(loadOpts.sheetName)}` : "";
      return `df = pd.read_excel(${f}${sheet})`;
    }
    case "stata":
      return `df = pd.read_stata(${f})`;
    case "rds":
      return `df = pyreadr.read_r(${f})[None]  # requires pyreadr`;
    case "parquet":
      return `df = pd.read_parquet(${f})`;
    case "shapefile-shp":
    case "shapefile-zip":
    case "shapefile-dbf":
      return `df = geopandas.read_file(${f})  # requires geopandas`;
    default:
      return `df = pd.read_csv(${f})  # adjust for your format`;
  }
}

// ─── Stata ───────────────────────────────────────────────────────────────────
export function buildStataLoadLine(filename, loadOpts = null) {
  const fmt = inferFormat(filename, loadOpts);
  const f   = stataPath(filename);
  switch (fmt) {
    case "csv": {
      const opts = [];
      if (loadOpts?.delimiter && loadOpts.delimiter !== "auto" && loadOpts.delimiter !== ",") {
        const d = loadOpts.delimiter === "\t" ? "tab" : `"${loadOpts.delimiter}"`;
        opts.push(`delimiter(${d})`);
      }
      if (loadOpts?.encoding && loadOpts.encoding !== "utf-8") {
        opts.push(`encoding("${loadOpts.encoding}")`);
      }
      opts.push("clear");
      return `import delimited "${f}", ${opts.join(" ")}`;
    }
    case "tsv":
      return `import delimited "${f}", delimiter(tab) clear`;
    case "excel": {
      const sheet = loadOpts?.sheetName ? ` sheet("${loadOpts.sheetName}")` : "";
      return `import excel "${f}", firstrow${sheet} clear`;
    }
    case "stata":
      return `use "${f}", clear`;
    case "rds":
      return `* .rds files are not natively supported in Stata; re-export as .dta first.\nuse "${f.replace(/\.rds$/i, ".dta")}", clear`;
    case "parquet":
      return `* Parquet not natively supported; convert to .dta first.\nuse "${f.replace(/\.parquet$/i, ".dta")}", clear`;
    case "shapefile-shp":
    case "shapefile-zip":
    case "shapefile-dbf":
      return `spshape2dta "${f.replace(/\.(shp|zip|dbf)$/i, "")}", replace\nuse "${f.replace(/\.(shp|zip|dbf)$/i, "")}", clear`;
    default:
      return `import delimited "${f}", clear`;
  }
}
