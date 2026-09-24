// ─── ECON STUDIO · services/AI/scriptNotesInput.js ───────────────────────────
// Prepares the deterministic replication script for the commentary call
// (generateScriptNotes): pasted DATA never leaves the browser, but the model
// still has to see that the data is there.
//
// The first version simply dropped every numeric-only line, so the model read
// `input double education__resid` … `end` with nothing in between and wrote
// "these blocks contain no data rows; the residual vectors must be pasted in
// manually" above a script that already carried all 5,289 of them (LMU PS4).
// A run of data lines now collapses to ONE placeholder comment that states the
// count, which is both true and carries no values.

const isDataLine = (l) => /[0-9]/.test(l) && /^[-+0-9.eE,\s]+$/.test(l.trim());

/**
 * @param {string} script  the full script
 * @param {string} cmt     the target language's comment character
 * @param {number} [maxChars]
 * @returns {string} the script with data runs replaced by one comment each
 */
export function collapseDataLines(script, cmt = "#", maxChars = 40000) {
  const out = [];
  let run = 0;
  const flush = () => {
    if (!run) return;
    out.push(`${cmt} … ${run} data value(s) pasted here (omitted from this prompt, present in the script)`);
    run = 0;
  };
  for (const line of String(script ?? "").split("\n")) {
    if (isDataLine(line)) { run++; continue; }
    flush();
    out.push(line);
  }
  flush();
  return out.join("\n").slice(0, maxChars);
}
