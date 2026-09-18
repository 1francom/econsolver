// ─── ECON STUDIO · services/export/injectColumnStep.js ───────────────────────
// Single owner of the `inject_column` step's emission (Extract panel: fitted
// values / residuals written back to the dataset as literal values). There
// were six copies and none of them produced a script that runs on real data:
//   Stata  `matrix x = (v1 \ v2 \ … )` on ONE line — with LMU PS4's 5,289
//          residuals a 90,000-character line that Stata never finishes parsing;
//   R      `c(v1, v2, …)` on one line — R refuses lines over 4,094 bytes;
//   all    values rounded to 8 decimals.
// Values are emitted at full precision, a few per line, and Stata reads them
// through `input … end` and merges them on row number, which is what the app
// does (the step replays by row position).
//
// The step stores VALUES, not the model they came from, so a script can only
// paste them back; re-deriving them (`predict …, residuals`) needs the source
// model recorded on the step — see CLAUDE.md.

const PER_LINE = 8;
const chunks = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += PER_LINE) out.push(arr.slice(i, i + PER_LINE));
  return out;
};
// Shortest string that round-trips the double exactly.
const num = (v, na) => (v == null || v === "" || !Number.isFinite(Number(v)) ? na : String(Number(v)));

export function injectColumnR(step, df = "df") {
  const vals = (step.values ?? []).map(v => num(v, "NA"));
  const name = JSON.stringify(String(step.colName));
  return [
    `# inject_column: ${name} — ${vals.length} values extracted from a model in Litux, pasted by row`,
    `${df}[[${name}]] <- c(`,
    ...chunks(vals).map((c, i, all) => `  ${c.join(", ")}${i < all.length - 1 ? "," : ""}`),
    `)`,
  ].join("\n");
}

export function injectColumnPython(step, df = "df") {
  const vals = (step.values ?? []).map(v => num(v, "np.nan"));
  const name = JSON.stringify(String(step.colName));
  return [
    `# inject_column: ${name} — ${vals.length} values extracted from a model in Litux, pasted by row`,
    `${df}[${name}] = np.array([`,
    ...chunks(vals).map(c => `    ${c.join(", ")},`),
    `])`,
  ].join("\n");
}

export function injectColumnStata(step) {
  const vals = (step.values ?? []).map(v => num(v, "."));
  const name = String(step.colName).replace(/[^\p{L}\p{N}_]/gu, "_").replace(/^(\p{N})/u, "_$1").slice(0, 32);
  return [
    `* inject_column: "${step.colName}" — ${vals.length} values extracted from a model in Litux, pasted by row`,
    `capture drop ${name}`,
    `gen long _lx_row = _n`,
    `preserve`,
    `clear`,
    `input double ${name}`,
    ...vals,
    `end`,
    `gen long _lx_row = _n`,
    `tempfile _lx_inj`,
    `save \`_lx_inj'`,
    `restore`,
    `merge 1:1 _lx_row using \`_lx_inj', nogenerate keep(master match)`,
    `sort _lx_row`,
    `drop _lx_row`,
  ].join("\n");
}
