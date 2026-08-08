// A group-split test must export a script that REFERENCES the data, not one
// that inlines it. The wide-format emitters dump every observation as a literal
// vector, which is fine for a handful of numbers typed into Simulate and
// useless for a real dataset — unreadable, unrunnable at size, and stale the
// moment the pipeline changes.
import assert from "node:assert/strict";
import { generateStatInferenceScript } from "../statInferenceScript.js";

const group = { valueCol: "y", groupCol: "treat", levelA: "1", levelB: "0" };
const OPS   = ["twoSampleMeanTest", "varianceRatioTest", "twoPropTest"];
const LANGS = ["r", "python", "stata"];
const gen = (lang, op, extra = {}) =>
  generateStatInferenceScript(lang, op, { group, alternative: "two-sided", pooled: false, mu0: 0, ...extra }, {});

// ─── THE REGRESSION THIS FILE EXISTS FOR ──────────────────────────────────────
// No literal data vectors anywhere in group mode.
for (const lang of LANGS) {
  for (const op of OPS) {
    const out = gen(lang, op);
    assert.ok(out && out.length, `${lang}/${op} produced nothing`);
    // Target the signature of a DATA dump specifically — `a <- c(...)` — not any
    // c(...), since `factor(g, levels = c(1, 0))` is a legitimate two-element list.
    assert.doesNotMatch(out, /^\s*[ab]\s*<-\s*c\(/m,      `${lang}/${op} inlined an R vector`);
    assert.doesNotMatch(out, /np\.asarray\(\[/,           `${lang}/${op} inlined a numpy array`);
    assert.doesNotMatch(out, /^replace .* in \d+$/m,      `${lang}/${op} inlined Stata data`);
    // It must name the actual columns instead.
    assert.match(out, /\by\b/,     `${lang}/${op} lost the outcome column`);
    assert.match(out, /\btreat\b/, `${lang}/${op} lost the group column`);
  }
}

// ─── R: the formula form, with the direction pinned ───────────────────────────
const rMean = gen("r", "twoSampleMeanTest");
assert.match(rMean, /t\.test\(y ~ factor\(treat, levels = c\(1, 0\)\)/);
// R spells it with a DOT. "two-sided" is not a valid `alternative` and the
// script would error out on the first line that matters.
assert.match(rMean, /alternative = "two\.sided"/);
assert.doesNotMatch(rMean, /"two-sided"/);
assert.match(gen("r", "twoSampleMeanTest", { alternative: "less" }), /alternative = "less"/);
assert.match(gen("r", "twoSampleMeanTest", { pooled: true }), /var\.equal = TRUE/);
assert.match(gen("r", "varianceRatioTest"), /var\.test\(y ~ factor\(/);

// Reversing the levels reverses the contrast, so the factor order must follow.
assert.match(
  generateStatInferenceScript("r", "twoSampleMeanTest", { group: { ...group, levelA: "0", levelB: "1" } }, {}),
  /levels = c\(0, 1\)/
);

// A string level is quoted; a numeric one is not, or Stata's inlist would miss.
const strGroup = { valueCol: "wage", groupCol: "region", levelA: "north", levelB: "south" };
assert.match(generateStatInferenceScript("r", "twoSampleMeanTest", { group: strGroup }, {}), /c\("north", "south"\)/);
assert.match(generateStatInferenceScript("stata", "twoSampleMeanTest", { group: strGroup }, {}), /inlist\(region, "north", "south"\)/);
assert.match(gen("stata", "twoSampleMeanTest"), /inlist\(treat, 1, 0\)/);

// A column name R cannot parse bare gets backticked.
assert.match(
  generateStatInferenceScript("r", "twoSampleMeanTest", { group: { ...group, valueCol: "log wage" } }, {}),
  /t\.test\(`log wage` ~/
);

// ─── Stata: its own idiom, not a transliteration of R ─────────────────────────
assert.match(gen("stata", "twoSampleMeanTest"), /^ttest y if .*, by\(treat\) unequal$/m);
assert.match(gen("stata", "twoSampleMeanTest", { pooled: true }), /by\(treat\)$/m);
assert.match(gen("stata", "varianceRatioTest"), /^sdtest y if .*, by\(treat\)$/m);
assert.match(gen("stata", "twoPropTest"), /^prtest y if .*, by\(treat\)$/m);

// ─── Python ───────────────────────────────────────────────────────────────────
assert.match(gen("python", "twoSampleMeanTest"), /df\.loc\[df\["treat"\]\.astype\("string"\) == "1", "y"\]/);
assert.match(gen("python", "twoSampleMeanTest"), /equal_var=False/);
// scipy/statsmodels spell the one-sided alternatives differently from the app.
assert.match(gen("python", "twoPropTest", { alternative: "greater" }), /alternative="larger"/);
assert.match(gen("python", "twoPropTest", { alternative: "less" }),    /alternative="smaller"/);

// ─── wide mode is untouched ───────────────────────────────────────────────────
// Without `group`, the old emitters must still produce their literal vectors —
// Simulate relies on them for data that exists nowhere but in the browser.
const wide = generateStatInferenceScript("r", "twoSampleMeanTest", { a: [1, 2, 3], b: [4, 5, 6] }, {});
assert.match(wide, /a <- c\(1, 2, 3\)/);

// An op with no long-format form falls through to the wide emitter rather than
// returning nothing. Pairing rows across two groups is meaningless, so `paired`
// is deliberately absent from the group path.
const paired = generateStatInferenceScript("r", "pairedMeanTest", { group, a: [1, 2], b: [3, 4] }, {});
assert.match(paired, /c\(1, 2\)/, "paired should fall back to the wide emitter");

// ─── DATASET-BACKED, NON-GROUP MODES ──────────────────────────────────────────
// Mounting the panel in Explore exposed the wide emitters to real data for the
// first time. A one-sample t-test over 1000 rows emitted a 97k-character line
// and R refused it outright: "the maximum number of characters accepted by R in
// a single line of input is 4094". Every column-taking test must reference the
// data when a dataset is behind the panel.
{
  const dataset = { colA: "y", colB: "z" };
  const OPS_DS = ["oneSampleMeanTest", "varianceTest", "pairedMeanTest",
                  "correlationTest", "twoSampleMeanTest", "varianceRatioTest"];
  for (const lang of LANGS) {
    for (const op of OPS_DS) {
      const out = generateStatInferenceScript(lang, op, { dataset, alternative: "two-sided", mu0: 0 }, {});
      assert.ok(out && out.length, `${lang}/${op} produced nothing`);
      assert.doesNotMatch(out, /^\s*[abx]\s*<-\s*c\(/m, `${lang}/${op} inlined an R vector`);
      assert.doesNotMatch(out, /np\.asarray\(\[/,        `${lang}/${op} inlined a numpy array`);
      assert.doesNotMatch(out, /^replace .* in \d+$/m,     `${lang}/${op} inlined Stata data`);
      assert.ok(out.length < 400, `${lang}/${op} is suspiciously long (${out.length} chars)`);
    }
  }
  assert.match(generateStatInferenceScript("r", "oneSampleMeanTest", { dataset, mu0: 5 }, {}), /t\.test\(df\$y, mu = 5/);
  // Stata: `ttest a == b` is PAIRED; unpaired needs the option, and confusing
  // the two silently answers a different question.
  assert.match(generateStatInferenceScript("stata", "pairedMeanTest", { dataset }, {}), /^ttest y == z$/m);
  assert.match(generateStatInferenceScript("stata", "twoSampleMeanTest", { dataset }, {}), /^ttest y == z, unpaired/m);
  // A test needing a second column falls back rather than emitting `df$undefined`.
  const noB = generateStatInferenceScript("r", "correlationTest", { dataset: { colA: "y" }, a: [1, 2], b: [3, 4] }, {});
  assert.match(noB, /c\(1, 2\)/, "missing colB should fall back to the wide emitter");
}

console.log("statInferenceGroup OK");
