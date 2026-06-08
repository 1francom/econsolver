// Node harness: run with `node src/__validation__/themeTokens.test.mjs`
import { buildTokens, MIN_FONT, MONO_STACK, SANS_STACK } from "../theme.js";
import assert from "node:assert";

let pass = 0;
function check(name, fn) { fn(); pass++; console.log("  ok -", name); }

// 1. comfortable density = base sizes
check("comfortable display = 28px", () => {
  const { T } = buildTokens({ density: "comfortable" });
  assert.equal(T.display.fontSize, "28px");
});

// 2. compact density scales by 0.88 and rounds
check("compact display = round(28*0.88)=25px", () => {
  const { T } = buildTokens({ density: "compact" });
  assert.equal(T.display.fontSize, "25px");
});

// 3. min-font clamp: label(10)*0.88=8.8→round 9, floor MIN_FONT
check("compact never below MIN_FONT", () => {
  const { T } = buildTokens({ density: "compact" });
  assert.ok(parseInt(T.label.fontSize) >= MIN_FONT);
  assert.ok(parseInt(T.caption.fontSize) >= MIN_FONT);
});

// 4. data + code roles stay mono regardless of sansFont
check("data/code roles locked to mono", () => {
  const { T } = buildTokens({ sansFont: "Inter" });
  assert.equal(T.data.fontFamily, MONO_STACK);
  assert.equal(T.code.fontFamily, MONO_STACK);
});

// 5. sansFont swaps sans roles
check("sansFont swaps sans roles", () => {
  const { T } = buildTokens({ sansFont: "Geist" });
  assert.ok(T.body.fontFamily.includes("Geist"));
  assert.ok(T.h1.fontFamily.includes("Geist"));
});

// 6. unknown sansFont falls back to Plex Sans
check("unknown sansFont falls back", () => {
  const { T } = buildTokens({ sansFont: "Nope" });
  assert.equal(T.body.fontFamily, SANS_STACK["IBM Plex Sans"]);
});

// 7. data role carries tabular-nums
check("data role has tabular-nums", () => {
  const { T } = buildTokens({});
  assert.equal(T.data.fontVariantNumeric, "tabular-nums");
});

// 8. space scales with density
check("space scales with density", () => {
  const a = buildTokens({ density: "comfortable" }).space;
  const b = buildTokens({ density: "compact" }).space;
  assert.equal(a[3], 8);
  assert.equal(b[3], Math.round(8 * 0.88));
});

// 9. elev is theme-split
check("elev differs by theme", () => {
  const d = buildTokens({ theme: "dark" }).elev;
  const l = buildTokens({ theme: "light" }).elev;
  assert.notEqual(d.popover.border, l.popover.border);
});

console.log(`\n${pass}/9 token checks passed`);
