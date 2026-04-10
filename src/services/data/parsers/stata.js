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

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseStata(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view  = new DataView(arrayBuffer);

  // ── Format / byte order ──────────────────────────────────────────────────
  const releaseStr = between(bytes, '<release>', '</release>').text.trim();
  const format = parseInt(releaseStr, 10); // 117 or 118
  if (format !== 117 && format !== 118) {
    throw new Error(`Unsupported Stata format: ${releaseStr}. Only 117/118 supported.`);
  }

  const boText = between(bytes, '<byteorder>', '</byteorder>').text.trim();
  const le = boText === 'LSF'; // little-endian if LSF

  // ── K, N ────────────────────────────────────────────────────────────────
  const kPos = tagPos(bytes, '<K>') + '<K>'.length;
  const K = view.getUint16(kPos, le);

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
  // Format 118: uint16 length prefix (max 320) + chars
  const labelTagPos = tagPos(bytes, '<label>') + '<label>'.length;
  let label = '';
  if (format === 118) {
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
