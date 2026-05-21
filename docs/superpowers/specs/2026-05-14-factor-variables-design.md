# Factor Variables in ModelingTab — Design Spec
Date: 2026-05-14

## Summary

Allow categorical (string) columns to appear in X/W variable pickers and be automatically one-hot encoded at estimation time. Numeric columns can be manually marked as factor via a `[f]` badge on the chip. Y picker remains numeric-only.

---

## State

`factorVars: Set<string>` in `ModelingTab.jsx`.

- Initialized with all string columns in the dataset (`headers.filter(h => !info[h]?.isNum)`).
- Updated via `toggleFactor(col)` — adds or removes from the set.
- If user removes factor from a string column, that column is also deselected from xVars/wVars (a raw string cannot be used as a continuous regressor).

---

## Chip UI (`shared.jsx`)

`Chip` gains two new optional props:
- `factored: boolean` — whether `[f]` is active (gold)
- `onFactor: fn | undefined` — click handler for the `[f]` badge; if undefined, badge not rendered

The chip renders as two clickable zones:
- Left zone (variable label) — existing selection behavior
- Right zone (`[f]` badge) — calls `onFactor`, `stopPropagation` so it doesn't trigger selection

Visual states:
```
numeric, f=off  → │ treat         [f] │   f in dim color
numeric, f=on   → │ ✓ treat       [f̲] │   f in gold, underlined/bold
string, f=on    → │ ✓ municipality [f̲] │   f always gold (pre-activated)
string, f=off   → not possible (deselects the variable)
```

---

## VarPanel (`shared.jsx`)

New props:
- `factorVars: Set<string>` — which vars are currently factored
- `onToggleFactor: (col: string) => void` — propagated to each Chip's `onFactor`

Y panel: no `factorVars`/`onToggleFactor` passed → chips render without `[f]`.

---

## VariableSelector (`VariableSelector.jsx`)

- Y panel: receives `numericCols` only (no change).
- X and W panels: receive `allCols` (all headers) instead of `numericCols`.
- `factorVars` and `onToggleFactor` passed to X and W panels.

---

## ModelingTab (`ModelingTab.jsx`)

### State initialization
```js
const [factorVars, setFactorVars] = useState(
  () => new Set(headers.filter(h => !info[h]?.isNum))
);
```
Re-initialize when dataset changes.

### toggleFactor
```js
function toggleFactor(col) {
  setFactorVars(prev => {
    const next = new Set(prev);
    if (next.has(col)) {
      next.delete(col);
      // If string column, deselect from X and W
      if (!info[col]?.isNum) {
        setXVars(v => v.filter(x => x !== col));
        setWVars(v => v.filter(x => x !== col));
      }
    } else {
      next.add(col);
    }
    return next;
  });
}
```

### applyFactors helper
Called inside `estimate()` before passing data to any engine:

```js
function applyFactors(rows, vars, factorVars) {
  const toExpand = vars.filter(v => factorVars.has(v));
  if (!toExpand.length) return { rows, vars };

  let expandedVars = [...vars];
  let expandedRows = rows;

  for (const col of toExpand) {
    const levels = [...new Set(rows.map(r => r[col]).filter(v => v != null))]
      .map(String).sort();
    const dummyLevels = levels.slice(1); // drop first = reference category

    const dummyCols = dummyLevels.map(lv => `${col}_${lv}`);
    expandedRows = expandedRows.map(r => {
      const val = String(r[col] ?? "");
      const dummies = Object.fromEntries(dummyCols.map(dc => {
        const lv = dc.slice(col.length + 1);
        return [dc, val === lv ? 1 : 0];
      }));
      return { ...r, ...dummies };
    });

    // Replace col with its dummy columns in the var list
    expandedVars = expandedVars.flatMap(v => v === col ? dummyCols : [v]);
  }

  return { rows: expandedRows, vars: expandedVars };
}
```

Apply for xVars and wVars independently before each engine call.

---

## Replication Code

In `rScript.js`, `stataScript.js`, `pythonScript.js`:

A helper wraps variable names conditionally:

**R:**
```js
const fmtR = v => factorVars.has(v) ? `factor(${rName(v)})` : rName(v);
const allX = [...xVars, ...wVars].map(fmtR).join(" + ");
```

**Stata:**
```js
const fmtStata = v => factorVars.has(v) ? `i.${v}` : v;
```

**Python (statsmodels formula):**
```js
const fmtPy = v => factorVars.has(v) ? `C(${v})` : v;
```

`factorVars` is passed to each generator as a new param (serialized as `Array.from(factorVars)`).

---

## Scope constraints

- Factor expansion applies to X and W only — never to Y.
- Engines receive only numeric columns post-expansion; no engine changes required.
- String columns that are not selected in X/W are not touched.
- Reference category = first level alphabetically (matches R's default).
- Column naming: `{col}_{level}` (underscores, spaces replaced).

---

## Files changed

| File | Change |
|------|--------|
| `src/components/modeling/shared.jsx` | `Chip` — `factored`/`onFactor` props; `VarPanel` — `factorVars`/`onToggleFactor`/allCols support |
| `src/components/modeling/VariableSelector.jsx` | Pass `allCols` to X/W, `numericCols` to Y; propagate factorVars |
| `src/components/modeling/ModelingTab.jsx` | `factorVars` state, `toggleFactor`, `applyFactors`, pass factorVars to VariableSelector and replication exports |
| `src/services/export/rScript.js` | `factorVars` param, `factor()` wrapping |
| `src/services/export/stataScript.js` | `factorVars` param, `i.` prefix |
| `src/services/export/pythonScript.js` | `factorVars` param, `C()` wrapping |
