/**
 * Stata .dta binary parser — formats 117 and 118 (Stata 13+)
 * parseStata(arrayBuffer) → { headers, rows, meta }
 *
 * Supports: byte, int, long, float, double, str1..str2045
 * strL (type 32768): treated as empty string ""
 * Missing values → null
 */

const MISSING = {
  byte:   101,
  int:    32741,
  long:   2147483621,
};

// Stata float/double special-value ranges (missing & extended missing)
// Float missings: .  = 0x7f000000, .a–.z = 0x7f000001..0x7f00001a
// Double missings: . = 0x7fe0000000000000 (as unsigned), etc.
function isFloatMissing(val) {
  // IEEE 754 bit pattern: Stata float missing range ≥ 0x7f000000 (as uint32)
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, val, false); // big-endian bits
  const bits = new DataView(buf).getUint32(0, false);
  return bits >= 0x7f000000;
}

function isDoubleMissing(val) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, val, false);
  const hi = new DataView(buf).getUint32(0, false);
  return hi >= 0x7fe00000;
}

// ── Tag search helpers ────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder('ascii');

function tagPos(bytes, tag, from = 0) {
  const needle = enc.encode(tag);
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function between(bytes, openTag, closeTag, from = 0) {
  const start = tagPos(bytes, openTag, from);
  if (start === -1) return { text: '', end: from };
  const contentStart = start + openTag.length;
  const end = tagPos(bytes, closeTag, contentStart);
  return {
    text: dec.decode(bytes.subarray(contentStart, end)),
    end: end + closeTag.length,
  };
}

// ── Old format parser (formats 113-116, Stata 8-12) ──────────────────────────
// Binary layout — no XML tags:
//   [0]       format byte (e.g. 115)
//   [1]       byteorder (1=MSF/big-endian, 2=LSF/little-endian)
//   [2]       filetype (1, unused)
//   [3]       unused (0)
//   [4-5]     K  uint16
//   [6-9]     N  uint32
//   [10-89]   dataset label (80 bytes, null-padded)
//   [90-107]  timestamp (18 bytes, null-padded)
//   then:     typlist (K bytes), varnames (K*NAME_LEN), sortlist, fmts,
//             value-label names, variable labels, characteristics, data, value-labels
//
// Type codes: 251=byte 252=int 253=long 254=float 255=double 1-244=str(N)
// Name/format lengths: formats 113 use 9/12/9/32; formats 114-116 use 33/49/33/81.

function parseStataOld(bytes, view) {
  const fmt      = bytes[0];
  const le       = bytes[1] === 2; // 2=LSF little-endian, 1=MSF big-endian
  const K        = view.getUint16(4, le);
  const N        = view.getUint32(6, le);

  // Layout constants differ by format version
  const NAME_LEN     = fmt >= 114 ? 33 : 9;
  const FMT_LEN      = fmt >= 114 ? 49 : 12;
  const LBLNAME_LEN  = fmt >= 114 ? 33 : 9;
  const VARLABEL_LEN = fmt >= 114 ? 81 : 32;

  // Header is 109 bytes: 4 (fixed fields) + 2 (K) + 4 (N) + 81 (label, null-terminated) + 18 (timestamp)
  // The dataset label is string(80) = 81 bytes including null terminator.
  let off = 109;

  // typlist
  const types = Array.from(bytes.subarray(off, off + K));
  off += K;

  // varnames
  const headers = [];
  const latin1  = new TextDecoder('latin1');
  for (let k = 0; k < K; k++) {
    const chunk = bytes.subarray(off, off + NAME_LEN);
    const end   = chunk.indexOf(0);
    headers.push(latin1.decode(chunk.subarray(0, end === -1 ? NAME_LEN : end)));
    off += NAME_LEN;
  }

  // sortlist — skip
  off += (K + 1) * 2;

  // fmtlist — read display formats to detect date columns
  // Stata date formats: %td (daily), %tm (monthly), %tq (quarterly), %th (half-yearly), %ty (yearly)
  const STATA_EPOCH = Date.UTC(1960, 0, 1); // 1960-01-01
  const fmts = [];
  for (let k = 0; k < K; k++) {
    const chunk = bytes.subarray(off, off + FMT_LEN);
    const end   = chunk.indexOf(0);
    fmts.push(latin1.decode(chunk.subarray(0, end === -1 ? FMT_LEN : end)));
    off += FMT_LEN;
  }
  // Map column index → date converter (null = not a date)
  const dateConv = fmts.map(f => {
    const m = f.match(/^%(-?\d+)?t([dqmhyw])/i);
    if (!m) return null;
    const unit = m[2].toLowerCase();
    return (v) => {
      if (v === null) return null;
      let ms;
      if (unit === 'd') ms = STATA_EPOCH + v * 86400000;
      else if (unit === 'w') ms = STATA_EPOCH + v * 7 * 86400000;
      else if (unit === 'm') { const y = 1960 + Math.floor(v / 12); const mo = ((v % 12) + 12) % 12; ms = Date.UTC(y, mo, 1); }
      else if (unit === 'q') { const y = 1960 + Math.floor(v / 4); const mo = ((v % 4) + 4) % 4 * 3; ms = Date.UTC(y, mo, 1); }
      else if (unit === 'h') { const y = 1960 + Math.floor(v / 2); const mo = (v % 2 + 2) % 2 * 6; ms = Date.UTC(y, mo, 1); }
      else if (unit === 'y') return String(v);  // year is itself
      else return v;
      return new Date(ms).toISOString().slice(0, 10);
    };
  });

  // value-label names, variable labels — skip
  off += K * LBLNAME_LEN;
  off += K * VARLABEL_LEN;

  // Compute expected data section size to find it safely
  const rowWidth = types.reduce((sum, t) => {
    if (t === 251) return sum + 1;
    if (t === 252) return sum + 2;
    if (t === 253 || t === 254) return sum + 4;
    if (t === 255) return sum + 8;
    if (t >= 1 && t <= 244) return sum + t;
    return sum;
  }, 0);
  const dataSize = N * rowWidth;

  // characteristics — skip safely.
  // Record layout: int32 datasize | str[NAME_LEN] varname | str[NAME_LEN] charname | char[datasize] contents
  // A zero datasize terminates the section.
  const charsStart = off;
  let charsOk = false;
  if (off + 4 <= bytes.length) {
    const firstLen = view.getUint32(off, le);
    // Sanity: a valid datasize is 0 (end marker) or small enough to fit
    if (firstLen === 0 || (firstLen < bytes.length - off && firstLen < 1_000_000)) {
      charsOk = true;
      while (off + 4 <= bytes.length) {
        const datasize = view.getUint32(off, le);
        off += 4;
        if (datasize === 0) break;
        // Each record also has varname + charname before the data content
        const recBody = 2 * NAME_LEN + datasize;
        if (recBody > bytes.length - off) { off -= 4; break; } // corrupt, stop
        off += recBody;
      }
    }
  }
  if (!charsOk) off = charsStart; // no / corrupt characteristics — start data here

  // data
  const rows = [];
  for (let n = 0; n < N; n++) {
    if (off + rowWidth > bytes.length) break;   // bounds guard — stop before overrun
    const row = {};
    for (let k = 0; k < K; k++) {
      const t = types[k];
      const h = headers[k];
      let val;
      if (t === 251) {                          // byte (int8)
        const v = view.getInt8(off); off += 1;
        val = v >= 101 ? null : v;
      } else if (t === 252) {                   // int (int16)
        const v = view.getInt16(off, le); off += 2;
        val = v >= 32741 ? null : v;
      } else if (t === 253) {                   // long (int32)
        const v = view.getInt32(off, le); off += 4;
        val = v >= 2147483621 ? null : v;
      } else if (t === 254) {                   // float
        const v = view.getFloat32(off, le); off += 4;
        val = isFloatMissing(v) ? null : v;
      } else if (t === 255) {                   // double
        const v = view.getFloat64(off, le); off += 8;
        val = isDoubleMissing(v) ? null : v;
      } else if (t >= 1 && t <= 244) {          // str(N)
        const chunk = bytes.subarray(off, off + t);
        const end   = chunk.indexOf(0);
        val = latin1.decode(chunk.subarray(0, end === -1 ? t : end));
        off += t;
      } else {
        val = null;
      }
      row[h] = dateConv[k] ? dateConv[k](val) : val;
    }
    rows.push(row);
  }

  if (!rows.length) throw new Error(`No data found in Stata format ${fmt} file.`);
  return {
    headers,
    rows,
    meta: { format: fmt, N, K, source: `Stata format ${fmt}` },
  };
}

// ── Main parser (formats 117-119, Stata 13-15) ────────────────────────────────

export function parseStata(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view  = new DataView(arrayBuffer);

  // ── Format / byte order ──────────────────────────────────────────────────
  // Formats 117-119 use XML-like tags. Pre-117 (Stata 12-) use raw binary.
  const releaseStr = between(bytes, '<release>', '</release>').text.trim();
  const format = parseInt(releaseStr, 10);

  if (!releaseStr) {
    // Pre-117: raw binary format (no XML tags). First byte = format number.
    return parseStataOld(bytes, view);
  }
  // Formats 117 (Stata 13), 118 (Stata 14), 119 (Stata 15 large datasets)
  if (format < 117 || format > 119) {
    throw new Error(`Unsupported Stata format ${format}. Supported: 117 (Stata 13), 118 (Stata 14), 119 (Stata 15).`);
  }

  const boText = between(bytes, '<byteorder>', '</byteorder>').text.trim();
  const le = boText === 'LSF'; // little-endian if LSF

  // ── K, N ────────────────────────────────────────────────────────────────
  const kPos = tagPos(bytes, '<K>') + '<K>'.length;
  // Format 119 uses uint32 for K to support > 32,767 variables; 117/118 use uint16
  const K = format === 119 ? view.getUint32(kPos, le) : view.getUint16(kPos, le);

  const nPos = tagPos(bytes, '<N>') + '<N>'.length;
  let N;
  if (format === 117) {
    N = view.getUint32(nPos, le);
  } else {
    // uint64 — JS safe up to 2^53
    const lo = view.getUint32(nPos, le);
    const hi = view.getUint32(nPos + 4, le);
    N = hi * 2 ** 32 + lo;
  }

  // ── Dataset label ────────────────────────────────────────────────────────
  // Format 117: uint8 length prefix (max 80) + chars
  // Formats 118/119: uint16 length prefix (max 320) + chars
  const labelTagPos = tagPos(bytes, '<label>') + '<label>'.length;
  let label = '';
  if (format >= 118) {
    const labelLen = view.getUint16(labelTagPos, le);
    label = dec.decode(bytes.subarray(labelTagPos + 2, labelTagPos + 2 + labelLen));
  } else {
    const labelLen = view.getUint8(labelTagPos);
    label = dec.decode(bytes.subarray(labelTagPos + 1, labelTagPos + 1 + labelLen));
  }

  // ── Timestamp ────────────────────────────────────────────────────────────
  const tsPos = tagPos(bytes, '<timestamp>') + '<timestamp>'.length;
  // 1-byte length prefix, then chars
  const tsLen = view.getUint8(tsPos);
  const timestamp = dec.decode(bytes.subarray(tsPos + 1, tsPos + 1 + tsLen));

  // ── Map (14 × uint64 offsets) ────────────────────────────────────────────
  const mapTagEnd = tagPos(bytes, '<map>') + '<map>'.length;
  const offsets = [];
  for (let i = 0; i < 14; i++) {
    const base = mapTagEnd + i * 8;
    const lo = view.getUint32(base, le);
    const hi = view.getUint32(base + 4, le);
    offsets.push(hi * 2 ** 32 + lo);
  }
  // Stata map layout (0-indexed):
  // [0]=stata_dta [1]=map [2]=variable_types [3]=varnames [4]=sortlist
  // [5]=formats [6]=value_label_names [7]=variable_labels [8]=characteristics
  // [9]=data [10]=strls [11]=value_labels [12]=</stata_dta> [13]=eof
  const dataOffset = offsets[9];

  // ── Variable types ───────────────────────────────────────────────────────
  const vtPos = tagPos(bytes, '<variable_types>') + '<variable_types>'.length;
  const types = [];
  for (let i = 0; i < K; i++) {
    types.push(view.getUint16(vtPos + i * 2, le));
  }

  // ── Variable names ───────────────────────────────────────────────────────
  const vnPos = tagPos(bytes, '<varnames>') + '<varnames>'.length;
  const headers = [];
  for (let i = 0; i < K; i++) {
    const start = vnPos + i * 33;
    let end = start;
    while (end < start + 33 && bytes[end] !== 0) end++;
    headers.push(dec.decode(bytes.subarray(start, end)));
  }

  // ── Row width ────────────────────────────────────────────────────────────
  function typeWidth(t) {
    if (t >= 1 && t <= 2045) return t;       // str# → # bytes
    if (t === 65530) return 1;               // byte
    if (t === 65529) return 2;               // int
    if (t === 65528) return 4;               // long
    if (t === 65527) return 4;               // float
    if (t === 65526) return 8;               // double
    if (t === 32768) return 8;               // strL (skip — 8-byte (v,o) pointer)
    return 0;
  }

  const widths = types.map(typeWidth);

  // ── Data ─────────────────────────────────────────────────────────────────
  // Skip past <data> tag at the mapped offset
  const dataTagLen = '<data>'.length;
  let pos = dataOffset + dataTagLen;

  const rows = [];
  for (let r = 0; r < N; r++) {
    const row = {};
    for (let c = 0; c < K; c++) {
      const t = types[c];
      const w = widths[c];
      const name = headers[c];
      let val;

      if (t >= 1 && t <= 2045) {
        // str# fixed-length, null-terminated
        let end = pos;
        while (end < pos + t && bytes[end] !== 0) end++;
        val = dec.decode(bytes.subarray(pos, end));
      } else if (t === 65530) {
        // byte (int8)
        const raw = view.getInt8(pos);
        val = raw >= MISSING.byte ? null : raw;
      } else if (t === 65529) {
        // int (int16)
        const raw = view.getInt16(pos, le);
        val = raw >= MISSING.int ? null : raw;
      } else if (t === 65528) {
        // long (int32)
        const raw = view.getInt32(pos, le);
        val = raw >= MISSING.long ? null : raw;
      } else if (t === 65527) {
        // float
        const raw = view.getFloat32(pos, le);
        val = isFloatMissing(raw) ? null : raw;
      } else if (t === 65526) {
        // double
        const raw = view.getFloat64(pos, le);
        val = isDoubleMissing(raw) ? null : raw;
      } else if (t === 32768) {
        // strL — skip 8-byte (v,o) pointer, return empty string
        val = '';
      } else {
        val = null;
      }

      row[name] = val;
      pos += w;
    }
    rows.push(row);
  }

  return {
    headers,
    rows,
    meta: { nObs: N, nVars: K, label, timestamp, format },
  };
}
