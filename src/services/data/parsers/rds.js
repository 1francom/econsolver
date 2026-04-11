/**
 * R .rds binary parser — XDR format (R serialization version 2 & 3)
 * parseRDS(arrayBuffer) → { headers: string[], rows: object[] }
 *
 * Handles the most common case: data.frame and named list of numeric/character
 * vectors. Throws a descriptive error for unsupported structures.
 *
 * R serialization format overview (version 2, XDR):
 *   Magic:  "X\n" (0x58 0x0A)  ← XDR binary
 *           "A\n"               ← ASCII (not supported here)
 *           "B\n"               ← native binary (not supported here)
 *   Bytes 2–5:  uint32 BE = format version (2 or 3)
 *   Bytes 6–9:  uint32 BE = writer R version
 *   Bytes 10–13: uint32 BE = min reader R version
 *   (version 3 adds a UTF-8 locale string before the root object)
 *
 * Object layout: 4-byte type+flags word (big-endian), then payload.
 *   SEXP types used here:
 *     NILSXP   (0)  = NULL
 *     SYMSXP   (1)  = symbol
 *     LISTSXP  (2)  = pairlist (tagged list: tag→car→cdr chain)
 *     REALSXP  (14) = double vector
 *     INTSXP   (13) = integer vector
 *     LGLSXP   (10) = logical vector
 *     STRSXP   (16) = character vector
 *     VECSXP   (19) = generic list (data.frame columns)
 *     CHARSXP  (9)  = single character string
 *     SPECIALSXP/BUILTINSXP (5/6) = function (unsupported)
 *
 * Attribute bit in the flags word (bit 9) means an attribute pairlist follows.
 */

// ── Constants ──────────────────────────────────────────────────────────────────
const NILSXP   = 0;
const SYMSXP   = 1;
const LISTSXP  = 2;
const LGLSXP   = 10;
const INTSXP   = 13;
const REALSXP  = 14;
const STRSXP   = 16;
const VECSXP   = 19;
const CHARSXP  = 9;

const HAS_ATTR_FLAG = 0x200;   // bit 9
const HAS_TAG_FLAG  = 0x400;   // bit 10
const IS_REF_FLAG   = 0xFF0000; // upper byte non-zero → reference

const NA_INT    = -2147483648;  // R's NA_integer_
const NA_REAL   = 0x7FF00000954 | 0; // checked via bit pattern below

/** True if the 64-bit IEEE pattern is R's NA_real_ (signaling NaN with payload) */
function isNAReal(hi, lo) {
  // R NA_real_: bits = 7FF00000 000007A2
  return hi === 0x7FF00000 && lo === 0x000007A2;
}

// ── Reader ─────────────────────────────────────────────────────────────────────
class XDRReader {
  constructor(buffer) {
    this.dv  = new DataView(buffer);
    this.pos = 0;
    // Reference table for REFSXP back-references
    this.refs = [null]; // 1-indexed
  }

  readUint32() {
    const v = this.dv.getUint32(this.pos, false); // big-endian
    this.pos += 4;
    return v;
  }
  readInt32() {
    const v = this.dv.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }
  readFloat64() {
    const v = this.dv.getFloat64(this.pos, false);
    this.pos += 8;
    return v;
  }
  readBytes(n) {
    const bytes = new Uint8Array(this.dv.buffer, this.pos, n);
    this.pos += n;
    return bytes;
  }
  readString(n) {
    const bytes = this.readBytes(n);
    return new TextDecoder("utf-8").decode(bytes);
  }

  /** Peek at the high/low uint32 of an IEEE double without advancing */
  peekDoubleWords() {
    const hi = this.dv.getUint32(this.pos,     false);
    const lo = this.dv.getUint32(this.pos + 4, false);
    return { hi, lo };
  }
}

// ── Object reader ──────────────────────────────────────────────────────────────
function readObject(r) {
  const word    = r.readUint32();
  const type    = word & 0xFF;
  const flags   = word;
  const hasAttr = (flags & HAS_ATTR_FLAG) !== 0;
  const hasTag  = (flags & HAS_TAG_FLAG)  !== 0;

  // Back-reference (REFSXP = 255): upper 24 bits hold the index (1-based)
  if (type === 255) {
    const idx = (flags >>> 8);
    if (idx > 0 && idx < r.refs.length) return r.refs[idx];
    throw new Error(`RDS: dangling back-reference ${idx}`);
  }

  // Allocate slot in reference table before reading children
  const refIdx = r.refs.length;
  r.refs.push(null);

  let obj;

  switch (type) {
    case NILSXP: {
      obj = null;
      break;
    }

    case SYMSXP: {
      // symbol: CHARSXP name
      const name = readObject(r);
      obj = { type: "symbol", name };
      break;
    }

    case CHARSXP: {
      const enc  = (flags >>> 12) & 0x7; // UTF-8=4, Latin-1=2, bytes=1
      const len  = r.readInt32();
      if (len === -1) { obj = null; break; } // NA_string_
      obj = r.readString(len);
      break;
    }

    case LISTSXP: {
      // Pairlist: optional tag, then car (value), then cdr (rest)
      let tag = null;
      if (hasAttr) readObject(r); // attributes on pairlist itself (unusual)
      if (hasTag)  tag = readObject(r);
      const car = readObject(r);
      const cdr = readObject(r);
      obj = { type: "pairlist", tag, car, cdr };
      break;
    }

    case LGLSXP: {
      const len   = r.readInt32();
      const vals  = [];
      for (let i = 0; i < len; i++) {
        const v = r.readInt32();
        vals.push(v === NA_INT ? null : v !== 0);
      }
      obj = { sxp: LGLSXP, values: vals };
      if (hasAttr) obj.attrs = readObject(r);
      break;
    }

    case INTSXP: {
      const len  = r.readInt32();
      const vals = [];
      for (let i = 0; i < len; i++) {
        const v = r.readInt32();
        vals.push(v === NA_INT ? null : v);
      }
      obj = { sxp: INTSXP, values: vals };
      if (hasAttr) obj.attrs = readObject(r);
      break;
    }

    case REALSXP: {
      const len  = r.readInt32();
      const vals = [];
      for (let i = 0; i < len; i++) {
        const { hi, lo } = r.peekDoubleWords();
        const v = r.readFloat64();
        vals.push(isNAReal(hi, lo) ? null : (isNaN(v) ? null : v));
      }
      obj = { sxp: REALSXP, values: vals };
      if (hasAttr) obj.attrs = readObject(r);
      break;
    }

    case STRSXP: {
      const len  = r.readInt32();
      const vals = [];
      for (let i = 0; i < len; i++) vals.push(readObject(r));
      obj = { sxp: STRSXP, values: vals };
      if (hasAttr) obj.attrs = readObject(r);
      break;
    }

    case VECSXP: {
      const len  = r.readInt32();
      const elts = [];
      for (let i = 0; i < len; i++) elts.push(readObject(r));
      obj = { sxp: VECSXP, elements: elts };
      if (hasAttr) obj.attrs = readObject(r);
      break;
    }

    default:
      throw new Error(`RDS: unsupported SEXP type ${type} at byte ${r.pos - 4}. ` +
        "Only data.frame and named numeric/character vectors are supported.");
  }

  r.refs[refIdx] = obj;
  return obj;
}

// ── Attribute helpers ──────────────────────────────────────────────────────────
/** Walk a pairlist and return a plain JS object {tagName → value} */
function attrsToMap(attrsNode) {
  const map = {};
  let node = attrsNode;
  while (node && node.type === "pairlist") {
    const tag = node.tag;
    const key = typeof tag === "object" && tag?.name ? tag.name : String(tag);
    map[key] = node.car;
    node = node.cdr;
  }
  return map;
}

/** Extract string values from a STRSXP (character vector) */
function strsxpStrings(obj) {
  if (!obj || obj.sxp !== STRSXP) return [];
  return obj.values.map(v => (v == null ? "" : String(v)));
}

/** Extract JS array from any vector sxp */
function vectorValues(obj) {
  if (!obj) return [];
  if (obj.sxp === REALSXP || obj.sxp === INTSXP || obj.sxp === LGLSXP) return obj.values;
  if (obj.sxp === STRSXP)  return obj.values.map(v => (v == null ? null : String(v)));
  return [];
}

// ── Main export ────────────────────────────────────────────────────────────────
/**
 * Parse an R .rds file (XDR binary serialization format).
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{ headers: string[], rows: object[] }}
 */
export async function parseRDS(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);

  // Validate magic bytes
  const magic0 = bytes[0];
  const magic1 = bytes[1];

  if (magic0 !== 0x58 || magic1 !== 0x0A) {
    if (magic0 === 0x41 && magic1 === 0x0A) {
      throw new Error("RDS: ASCII format (.rds) is not supported — please re-save with saveRDS(..., compress=FALSE, ascii=FALSE) in R.");
    }
    if (magic0 === 0x42 && magic1 === 0x0A) {
      throw new Error("RDS: Native binary format is not supported — please re-save with saveRDS(..., version=2) in R.");
    }
    // Could be a gzip-compressed RDS (most common when saved with compress=TRUE)
    // Gzip magic: 0x1F 0x8B
    if (magic0 === 0x1F && magic1 === 0x8B) {
      throw new Error(
        "RDS: File appears to be gzip-compressed. " +
        "Browser cannot decompress it natively. " +
        "Re-save with: saveRDS(obj, file, compress=FALSE) in R, or convert to CSV."
      );
    }
    throw new Error(`RDS: Unrecognized file magic 0x${magic0.toString(16)} 0x${magic1.toString(16)}. Is this an .rds file?`);
  }

  const r = new XDRReader(arrayBuffer);
  r.pos = 2; // skip "X\n"

  const version = r.readUint32();  // bytes 2–5
  r.readUint32();                  // writer R version (bytes 6–9)
  r.readUint32();                  // min R version (bytes 10–13)

  if (version < 2 || version > 3) {
    throw new Error(`RDS: Unsupported serialization version ${version}. Expected 2 or 3.`);
  }

  // Version 3 adds a UTF-8 locale string
  if (version === 3) {
    const nativeEncLen = r.readInt32();
    if (nativeEncLen > 0) r.readString(nativeEncLen);
  }

  const root = readObject(r);

  // ── Try to convert to { headers, rows } ────────────────────────────────────

  // Helper: build rows from a column-keyed object
  function buildTable(colNames, colArrays) {
    const nRow = colArrays.length ? colArrays[0].length : 0;
    const rows = [];
    for (let i = 0; i < nRow; i++) {
      const row = {};
      colNames.forEach((h, j) => { row[h] = colArrays[j][i] ?? null; });
      rows.push(row);
    }
    return { headers: colNames, rows };
  }

  // Case 1: VECSXP (data.frame or named list)
  if (root && root.sxp === VECSXP) {
    const attrMap = root.attrs ? attrsToMap(root.attrs) : {};
    const namesSxp = attrMap["names"];
    const names    = strsxpStrings(namesSxp);

    if (!names.length) {
      throw new Error("RDS: VECSXP has no 'names' attribute — cannot determine column names. Save as a named list or data.frame.");
    }

    const colArrays = root.elements.map(el => vectorValues(el));
    return buildTable(names, colArrays);
  }

  // Case 2: Single named vector (REALSXP / INTSXP / STRSXP with names attr)
  if (root && (root.sxp === REALSXP || root.sxp === INTSXP || root.sxp === STRSXP)) {
    const attrMap  = root.attrs ? attrsToMap(root.attrs) : {};
    const namesSxp = attrMap["names"];
    if (namesSxp) {
      // Named vector → one row per element, two columns: name + value
      const names  = strsxpStrings(namesSxp);
      const values = vectorValues(root);
      const rows   = names.map((n, i) => ({ name: n, value: values[i] ?? null }));
      return { headers: ["name", "value"], rows };
    }
    // Un-named vector → single column "value"
    const values = vectorValues(root);
    const rows   = values.map(v => ({ value: v }));
    return { headers: ["value"], rows };
  }

  throw new Error(
    "RDS: Unsupported R object type at root. " +
    "parseRDS handles data.frame, named list, and numeric/character vectors. " +
    "Save your data as a data.frame with saveRDS(df, 'file.rds', compress=FALSE, version=2)."
  );
}
