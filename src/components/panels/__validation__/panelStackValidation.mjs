import assert from "node:assert/strict";
import { computeSlots, PANEL_MARGIN, PANEL_GAP } from "../panelStackMath.js";

// Nothing registered.
assert.equal(computeSlots([], ["clean"]).size, 0);

// A single app-scoped panel (tab === null) sits at the margin, whatever is on screen.
assert.equal(computeSlots([{ id: "a", height: 100, tab: null }], []).get("a"), PANEL_MARGIN);

// Two visible panels stack upward in registration order.
const two = computeSlots([
  { id: "a", height: 100, tab: null },
  { id: "b", height: 200, tab: null },
], []);
assert.equal(two.get("a"), PANEL_MARGIN);
assert.equal(two.get("b"), PANEL_MARGIN + 100 + PANEL_GAP);

// THE REGRESSION THIS FILE EXISTS FOR: a module panel whose tab is off screen is
// still mounted and still registered (App hides tab panels with display:none
// rather than unmounting them, to preserve their state), so it must consume NO
// vertical space. If it did, the artifact viewer would float above an invisible
// gap.
const hidden = computeSlots([
  { id: "distinct",  height: 360, tab: "clean" },
  { id: "artifacts", height: 400, tab: null },
], ["model"]);
assert.equal(hidden.get("distinct"),  null);
assert.equal(hidden.get("artifacts"), PANEL_MARGIN);

// Same registration, clean now on screen → the module panel takes the bottom slot.
const shown = computeSlots([
  { id: "distinct",  height: 360, tab: "clean" },
  { id: "artifacts", height: 400, tab: null },
], ["clean"]);
assert.equal(shown.get("distinct"),  PANEL_MARGIN);
assert.equal(shown.get("artifacts"), PANEL_MARGIN + 360 + PANEL_GAP);

// Split view: App can show two panes at once, so MEMBERSHIP decides visibility,
// not equality against a single active tab.
assert.equal(
  computeSlots([{ id: "distinct", height: 360, tab: "clean" }], ["model", "clean"]).get("distinct"),
  PANEL_MARGIN
);

// App's pane array carries nulls for an unused pane — those must not match a
// panel whose tab is null (app-scoped), which would hide it whenever a pane is
// empty. Membership is checked only for panels that HAVE a tab.
assert.equal(
  computeSlots([{ id: "a", height: 100, tab: null }], ["clean", null]).get("a"),
  PANEL_MARGIN
);

// Defensive: a null/undefined panel list must not throw.
assert.equal(computeSlots(undefined, []).size, 0);
assert.equal(computeSlots(null, undefined).size, 0);

console.log("panelStackMath OK");
