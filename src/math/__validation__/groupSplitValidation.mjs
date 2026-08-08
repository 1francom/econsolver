// splitByGroup turns LONG data (one outcome column + one group column) into the
// two arrays the two-sample tests already take. It exists because the tests only
// accepted WIDE input — two separate columns — which is `t.test(y1, y2)` in R
// while econometric data is almost always shaped for `t.test(y ~ treat)`.
//
// The guarantee that matters: the two input modes must produce the SAME test
// result on the same data. That is asserted here directly rather than assumed.
import assert from "node:assert/strict";
import { splitByGroup, groupLevels, twoSampleMeanTest, oneSampleMeanTest } from "../SampleTests.js";

// ─── missing values are dropped, not counted as zeros ─────────────────────────
// `Number(null)` and `Number("")` are 0, and 0 is finite, so the original
// `.map(Number).filter(finite)` kept every missing value as a zero observation.
// This is asserted first because every test below inherits it.
{
  const full    = oneSampleMeanTest([10, 12, 14], 0);
  const withNAs = oneSampleMeanTest([10, 12, 14, null, undefined, ""], 0);
  assert.equal(withNAs.n, full.n, "missing values inflated n");
  assert.equal(withNAs.estimate, full.estimate, "missing values shifted the mean toward zero");
  assert.equal(withNAs.estimate, 12);
  // A real zero is data, not a blank — it must still count.
  assert.equal(oneSampleMeanTest([10, 12, 14, 0], 0).n, 4);
}

const rows = [
  { y: 10, treat: 1, region: "north" },
  { y: 12, treat: 1, region: "south" },
  { y: 14, treat: 1, region: "north" },
  { y:  4, treat: 0, region: "north" },
  { y:  6, treat: 0, region: "south" },
  { y:  8, treat: 0, region: "south" },
];

// ─── the basic split ──────────────────────────────────────────────────────────
const { a, b } = splitByGroup(rows, "y", "treat", 1, 0);
assert.deepEqual(a, [10, 12, 14]);
assert.deepEqual(b, [4, 6, 8]);

// Levels are matched as TEXT, matching the canonical condition language where
// `eq` is a string comparison — so a numeric 1 and the string "1" are the same
// level, which is what a user picking from a dropdown expects.
assert.deepEqual(splitByGroup(rows, "y", "treat", "1", "0").a, [10, 12, 14]);

// Order of the two levels is the contrast direction, not a detail.
const flipped = splitByGroup(rows, "y", "treat", 0, 1);
assert.deepEqual(flipped.a, [4, 6, 8]);

// ─── THE GUARANTEE: long and wide modes must agree ────────────────────────────
// Wide mode is what the panel does today: two columns handed straight to the
// test. Long mode must reach the identical result.
const wide = twoSampleMeanTest([10, 12, 14], [4, 6, 8]);
const long = twoSampleMeanTest(a, b);
assert.equal(long.estimate, wide.estimate);
assert.equal(long.stat,     wide.stat);
assert.equal(long.pValue,   wide.pValue);
assert.equal(long.nA,       wide.nA);
assert.equal(long.nB,       wide.nB);

// ─── rows that must not silently join a group ─────────────────────────────────
const messy = [
  { y: 10, g: "a" },
  { y: null, g: "a" },      // null outcome — the test's own cleaner drops it
  { y: "x", g: "a" },       // non-numeric outcome — same
  { y: 99, g: null },       // NULL GROUP: belongs to neither side
  { y: 99, g: "" },         // empty group label is a level of its own, not "a"
  { y: 20, g: "b" },
  { y: 22, g: "b" },
  { y: 50, g: "c" },        // a third level is simply not in the contrast
];
const m = splitByGroup(messy, "y", "g", "a", "b");
// The split passes values through raw; the tests clean them. Doing our own
// filtering here would make the two modes disagree the moment the cleaners drift.
assert.equal(m.a.length, 3, "group a keeps its rows, including the ones the test will drop");
assert.deepEqual(m.b, [20, 22]);
assert.ok(!m.a.includes(99) && !m.b.includes(99), "a null group joined a side");
assert.ok(!m.a.includes(50) && !m.b.includes(50), "an unselected level leaked in");

// After the test's own cleaning, group a has exactly one usable observation, so
// the test refuses rather than reporting a contrast built on one point.
const tooFew = twoSampleMeanTest(m.a, m.b);
assert.ok(tooFew.error, "expected an error when a group has fewer than 2 numeric values");

// ─── defensive ────────────────────────────────────────────────────────────────
assert.deepEqual(splitByGroup([], "y", "g", "a", "b"), { a: [], b: [] });
assert.deepEqual(splitByGroup(undefined, "y", "g", "a", "b"), { a: [], b: [] });
// Same level on both sides is a user error, not a crash: it yields two identical
// samples, and the test then reports a zero difference with zero variance.
assert.deepEqual(splitByGroup(rows, "y", "treat", 1, 1).b, [10, 12, 14]);

// ─── distinct levels for the picker ───────────────────────────────────────────
assert.deepEqual(groupLevels(rows, "treat"), [1, 0]);            // first-seen order, raw values
assert.deepEqual(groupLevels(rows, "region"), ["north", "south"]);
// Null is not a level; the empty string is one.
assert.deepEqual(groupLevels(messy, "g"), ["a", "", "b", "c"]);
assert.deepEqual(groupLevels([], "g"), []);

console.log("groupSplit OK");
