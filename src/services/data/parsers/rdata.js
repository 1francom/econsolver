/**
 * R .RData / .rda workspace parser
 * parseRData(arrayBuffer) → { tables: [{ name, headers, rows }], skipped: [{ name, reason }] }
 *
 * A workspace is the SAME serialization stream an .rds file uses — the two
 * differences are:
 *   1. A 5-byte workspace magic ("RDX2\n" or "RDX3\n") precedes the "X\n"
 *      serialization header. RDX1 is R < 1.4 and is not supported.
 *   2. The root object is a PAIRLIST of name→value bindings (one per object in
 *      the workspace), not a single object.
 *
 * So the reader, the SEXP decoder, and the table conversion are all reused from
 * rds.js; this file only strips the magic and walks the binding chain.
 *
 * Because a workspace can hold many objects, this returns EVERY data.frame it
 * finds. Non-tabular bindings (functions, scalars, models, lists of unequal
 * length) are reported in `skipped` rather than dropped silently — a workspace
 * that produced nothing loadable should say why.
 */

import { readSerializedStream, sexpToTable, decompressGzip } from "./rds.js";

// R's own workspace magic strings (see R's src/main/saveload.c).
const MAGIC = {
  "RDX2\n": 5,
  "RDX3\n": 5,
};

/** Read the first `n` bytes as latin-1 so magic comparison is byte-exact. */
function peekAscii(bytes, n) {
  let s = "";
  for (let i = 0; i < n && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * Walk a LISTSXP binding chain into [{ name, value }].
 * The chain is { tag: SYMSXP, car: value, cdr: next }, terminated by null.
 */
function walkBindings(root) {
  const out = [];
  let node = root;
  let guard = 0;
  while (node && node.type === "pairlist") {
    if (++guard > 100_000) throw new Error("RData: binding chain too long — file may be corrupt.");
    const tag  = node.tag;
    const name = (tag && typeof tag === "object" && typeof tag.name === "string")
      ? tag.name
      : (typeof tag === "string" ? tag : null);
    if (name) out.push({ name, value: node.car });
    node = node.cdr;
  }
  return out;
}

/**
 * Reject ragged "data.frames". sexpToTable sizes the table off the FIRST
 * column, so a named list whose members have different lengths would silently
 * truncate or pad. A workspace holds arbitrary named lists, so this check
 * matters much more here than it does for a single .rds.
 */
function raggedReason(value) {
  if (!value || !Array.isArray(value.elements) || !value.elements.length) return null;
  const lens = value.elements.map(el => {
    if (!el) return 0;
    if (Array.isArray(el.values))   return el.values.length;
    if (Array.isArray(el.elements)) return el.elements.length;
    return 0;
  });
  const first = lens[0];
  return lens.every(l => l === first)
    ? null
    : `named list with unequal element lengths (${lens.join(", ")}) — not a data.frame`;
}

/**
 * Parse an R workspace file (.RData / .rda).
 * Handles gzip-compressed workspaces automatically (R's `save()` default).
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ tables: {name:string,headers:string[],rows:object[]}[],
 *                     skipped: {name:string,reason:string}[] }>}
 */
export async function parseRData(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 8) throw new Error("RData: file is too small to be an R workspace.");

  // ── Compression ─────────────────────────────────────────────────────────────
  // R compresses the WHOLE file, magic included, so detection happens before
  // the magic check and the decompressed buffer is re-parsed from the top.
  if (bytes[0] === 0x1F && bytes[1] === 0x8B) {
    return parseRData(await decompressGzip(arrayBuffer));
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x5A && bytes[2] === 0x68) {
    throw new Error(
      "RData: bzip2-compressed workspaces are not supported by the browser. " +
      "Re-save in R with save(..., compress=\"gzip\") — or compress=FALSE."
    );
  }
  if (bytes[0] === 0xFD && bytes[1] === 0x37 && bytes[2] === 0x7A && bytes[3] === 0x58) {
    throw new Error(
      "RData: xz-compressed workspaces are not supported by the browser. " +
      "Re-save in R with save(..., compress=\"gzip\") — or compress=FALSE."
    );
  }

  // ── Workspace magic ─────────────────────────────────────────────────────────
  const head5 = peekAscii(bytes, 5);
  let startPos = MAGIC[head5];

  if (startPos == null) {
    if (head5.startsWith("RDA2") || head5.startsWith("RDB2") || head5.startsWith("RDX1")) {
      throw new Error(
        `RData: workspace format "${head5.trim()}" is not supported (ASCII, native-binary, ` +
        "or pre-R-1.4). Re-save with save(..., compress=\"gzip\", ascii=FALSE)."
      );
    }
    // Tolerate an .rds that was named .RData — it has no workspace magic, just
    // the bare "X\n" serialization header and a single unnamed root object.
    if (bytes[0] === 0x58 && bytes[1] === 0x0A) {
      const { root } = readSerializedStream(arrayBuffer, 0);
      try {
        const t = sexpToTable(root);
        return { tables: [{ name: "data", ...t }], skipped: [] };
      } catch (e) {
        throw new Error(`RData: file holds a single R object that is not tabular — ${e.message}`);
      }
    }
    throw new Error(
      `RData: unrecognised file magic "${head5.replace(/[^\x20-\x7E]/g, ".")}". ` +
      "Is this an .RData / .rda workspace?"
    );
  }

  // ── Parse ───────────────────────────────────────────────────────────────────
  const { root } = readSerializedStream(arrayBuffer, startPos);
  const bindings = walkBindings(root);
  if (!bindings.length) throw new Error("RData: workspace contains no named objects.");

  const tables  = [];
  const skipped = [];

  for (const { name, value } of bindings) {
    // Only VECSXP (data.frame / tibble / named list) becomes a dataset. A bare
    // scalar or vector in a workspace is almost never a table the user wants
    // loaded, so it is reported rather than turned into a one-column dataset.
    if (!value || value.sxp !== 19 /* VECSXP */) {
      skipped.push({ name, reason: "not a data.frame" });
      continue;
    }
    const ragged = raggedReason(value);
    if (ragged) { skipped.push({ name, reason: ragged }); continue; }
    try {
      const { headers, rows } = sexpToTable(value);
      if (!headers.length) { skipped.push({ name, reason: "no columns" }); continue; }
      tables.push({ name, headers, rows });
    } catch (e) {
      skipped.push({ name, reason: e.message });
    }
  }

  if (!tables.length) {
    const detail = skipped.map(s => `${s.name} (${s.reason})`).join(", ");
    throw new Error(`RData: no data.frame found in the workspace. Objects present: ${detail}.`);
  }
  return { tables, skipped };
}
