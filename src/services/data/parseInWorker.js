// ─── ECON STUDIO · services/data/parseInWorker.js ────────────────────────────
// Promise wrapper around workers/parse.worker.js. Falls back to parsing on the
// main thread when a Worker cannot be created (old browser, test runner), so a
// file always loads — the worker only changes whether the UI stays responsive.
//
//   parseInWorker("csv",   buf, { delimiter }) → { parsed, delimiter }
//   parseInWorker("excel", buf)               → { tables, skipped }
//   parseInWorker("stata" | "rds" | "rdata", buf) → that parser's result

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("../../workers/parse.worker.js", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
  };
  worker.onerror = (e) => {
    // A worker that fails to start (typically its chunk could not be fetched
    // after a dev-server restart) takes every in-flight parse with it. The
    // buffers were transferred, so they cannot be retried here: fail loudly,
    // and start a fresh worker next time.
    const inflight = [...pending.values()];
    pending.clear();
    worker = null;
    e.preventDefault?.();
    const msg = "The file parser could not start (" + (e?.message || "worker error") + "). Reload the page and try again.";
    inflight.forEach(p => p.reject(new Error(msg)));
  };
  return worker;
}

async function parseInline(kind, buf, { delimiter } = {}) {
  if (kind === "csv") {
    const { parseCSV, detectDelimiter } = await import("./parsers/tabular.js");
    const text = new TextDecoder("utf-8").decode(buf);
    const delim = delimiter ?? detectDelimiter(text);
    return { parsed: parseCSV(text, delim), delimiter: delim };
  }
  if (kind === "excel") return (await import("./parsers/tabular.js")).parseExcelBuffer(buf);
  if (kind === "stata") return (await import("./parsers/stata.js")).parseStata(buf);
  if (kind === "rds")   return (await import("./parsers/rds.js")).parseRDS(buf);
  if (kind === "rdata") return (await import("./parsers/rdata.js")).parseRData(buf);
  throw new Error(`Unknown parse kind: ${kind}`);
}

export function parseInWorker(kind, buf, opts = {}) {
  const w = getWorker();
  if (!w) return parseInline(kind, buf, opts);
  const id = ++seq;
  // Transferred, not copied: the caller must not use `buf` afterwards.
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, kind, buf, delimiter: opts.delimiter }, [buf]);
  });
}
