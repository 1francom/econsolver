// ─── ECON STUDIO · workers/parse.worker.js ───────────────────────────────────
// Parses uploaded files off the main thread, so the UI keeps drawing (and the
// loading indicator keeps moving) while a large CSV / workbook / .dta / .rds is
// read. Messages: { id, kind, buf, delimiter? } → { id, ok, result | error }.
// The ArrayBuffer is transferred in, so nothing is copied on the way.

import { parseCSV, detectDelimiter, parseExcelBuffer } from "../services/data/parsers/tabular.js";

async function parse(kind, buf, delimiter) {
  switch (kind) {
    case "csv": {
      const text = new TextDecoder("utf-8").decode(buf);
      const delim = delimiter ?? detectDelimiter(text);
      return { parsed: parseCSV(text, delim), delimiter: delim };
    }
    case "excel": return parseExcelBuffer(buf);
    case "stata": { const { parseStata } = await import("../services/data/parsers/stata.js"); return parseStata(buf); }
    case "rds":   { const { parseRDS }   = await import("../services/data/parsers/rds.js");   return parseRDS(buf); }
    case "rdata": { const { parseRData } = await import("../services/data/parsers/rdata.js"); return parseRData(buf); }
    default: throw new Error(`Unknown parse kind: ${kind}`);
  }
}

self.onmessage = async ({ data }) => {
  const { id, kind, buf, delimiter } = data;
  try {
    self.postMessage({ id, ok: true, result: await parse(kind, buf, delimiter) });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e?.message ?? String(e) });
  }
};
