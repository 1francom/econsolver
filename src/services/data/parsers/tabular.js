// ─── ECON STUDIO · services/data/parsers/tabular.js ───────────────────────────
// Pure CSV / Excel parsing, shared by DataStudio and parse.worker.js so large
// files parse off the main thread. Moved verbatim from DataStudio.jsx.
import * as XLSX from "xlsx";

export function parseCSV(text, delimiter = ",") {
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

// A workbook is a COLLECTION of sheets, so parseExcelBuffer returns every one:
// { tables: [{ name, headers, rows }], skipped: [{ name, reason }] }.
export const EXCEL_NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|\.|\s*)$/i;

function excelRows(data) {
  const headers = Object.keys(data[0]);
  const rows = data.map(r => {
    const row = {};
    headers.forEach(h => {
      const v = r[h];
      if (v === null || v === undefined) { row[h] = null; return; }
      if (typeof v === "number") { row[h] = v; return; }
      const t = String(v).trim();
      if (!t || EXCEL_NA_PAT.test(t)) { row[h] = null; return; }
      const n = Number(t.replace(/,(?=\d{3})/g, ""));
      row[h] = isNaN(n) ? t : n;
    });
    return row;
  });
  return { headers, rows };
}

export function parseExcelBuffer(buf) {
  const wb  = XLSX.read(buf, { type: "array", cellDates: true });
  if (!wb.SheetNames?.length) throw new Error("Excel file has no sheets.");

  const tables = [];
  const skipped = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) { skipped.push({ name, reason: "sheet missing from workbook" }); continue; }
    let data;
    try {
      data = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
    } catch (e) {
      skipped.push({ name, reason: e?.message || "could not be read" });
      continue;
    }
    // Empty and header-only sheets are extremely common in real workbooks
    // (blank tabs, notes). Report them rather than failing the whole file.
    if (!data.length) { skipped.push({ name, reason: "no rows" }); continue; }
    const { headers, rows } = excelRows(data);
    if (!headers.length) { skipped.push({ name, reason: "no columns" }); continue; }
    tables.push({ name, headers, rows });
  }

  if (!tables.length) {
    const detail = skipped.map(s => `${s.name} (${s.reason})`).join(", ");
    throw new Error(`No readable sheet in this workbook${detail ? ` — ${detail}` : ""}.`);
  }
  return { tables, skipped };
}

export function detectDelimiter(text) {
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
