// ─── ECON STUDIO · pipeline/registry.js ──────────────────────────────────────
// Single source of truth for all pipeline step types.
// Adding a new step = adding one entry here. Nothing else changes.
//
// Each entry defines:
//   type        string   — matches the case in runner.js applyStep()
//   label       string   — human-readable name shown in UI
//   category    string   — tab/group in the UI
//   description string   — tooltip / help text
//   schema      object   — field definitions for the step config form
//   toLabel     fn       — produces a short audit-trail label from a step object
//   defaultStep fn       — produces a valid default step object
//
// schema field types:
//   "col"        — single column selector
//   "cols"       — multi-column selector
//   "text"       — free text input
//   "select"     — dropdown  { options: [{value, label}] }
//   "number"     — numeric input
//   "boolean"    — checkbox
//   "map"        — key→value mapping editor (recode / normalize_cats)
//   "aggs"       — aggregation list editor (group_summarize)
//   "parts"      — date part selector (date_extract)

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
export const CATEGORIES = [
  { id: "cleaning",  label: "Cleaning"  },
  { id: "features",  label: "Features"  },
  { id: "reshape",   label: "Reshape"   },
  { id: "merge",     label: "Merge"     },
];

// ─── REGISTRY ─────────────────────────────────────────────────────────────────
export const STEP_REGISTRY = [

  // ── CLEANING ────────────────────────────────────────────────────────────────

  {
    type: "rename",
    label: "Rename column",
    category: "cleaning",
    description: "Rename a column. Updates all references in the header list.",
    schema: [
      { key: "col",     type: "col",  label: "Column" },
      { key: "newName", type: "text", label: "New name" },
    ],
    toLabel: s => `rename ${s.col} → ${s.newName}`,
    defaultStep: () => ({ type: "rename", col: "", newName: "" }),
  },

  {
    type: "drop",
    label: "Drop column",
    category: "cleaning",
    description: "Remove a column entirely from the dataset.",
    schema: [
      { key: "col", type: "col", label: "Column to drop" },
    ],
    toLabel: s => `drop ${s.col}`,
    defaultStep: () => ({ type: "drop", col: "" }),
  },

  {
    type: "filter",
    label: "Filter rows",
    category: "cleaning",
    description: "Keep only rows matching a condition.",
    schema: [
      { key: "col", type: "col",    label: "Column" },
      { key: "op",  type: "select", label: "Operator", options: [
        { value: "notna", label: "is not missing" },
        { value: "eq",    label: "= (equals)" },
        { value: "neq",   label: "≠ (not equals)" },
        { value: "gt",    label: "> (greater than)" },
        { value: "lt",    label: "< (less than)" },
        { value: "gte",   label: "≥ (greater or equal)" },
        { value: "lte",   label: "≤ (less or equal)" },
      ]},
      { key: "value", type: "text", label: "Value", when: s => s.op !== "notna" },
    ],
    toLabel: s => `filter ${s.col} ${s.op} ${s.value ?? ""}`.trim(),
    defaultStep: () => ({ type: "filter", col: "", op: "notna", value: "" }),
  },

  {
    type: "drop_na",
    label: "Drop missing rows",
    category: "cleaning",
    description: "Remove rows where selected columns are null. 'any' drops if any column is null; 'all' drops only if every column is null.",
    schema: [
      { key: "cols", type: "cols",   label: "Columns (leave empty = all)" },
      { key: "how",  type: "select", label: "Mode", options: [
        { value: "any", label: "any — drop if any selected column is null" },
        { value: "all", label: "all — drop only if all selected columns are null" },
      ]},
    ],
    toLabel: s => `drop_na [${(s.cols || []).join(", ") || "all cols"}] (${s.how || "any"})`,
    defaultStep: () => ({ type: "drop_na", cols: [], how: "any" }),
  },

  {
    type: "fill_na",
    label: "Fill missing values",
    category: "cleaning",
    description: "Impute null values in a column using a chosen strategy.",
    schema: [
      { key: "col",      type: "col",    label: "Column" },
      { key: "strategy", type: "select", label: "Strategy", options: [
        { value: "mean",          label: "Mean" },
        { value: "median",        label: "Median" },
        { value: "mode",          label: "Mode (most frequent)" },
        { value: "constant",      label: "Constant value" },
        { value: "forward_fill",  label: "Forward fill (LOCF)" },
        { value: "backward_fill", label: "Backward fill (NOCB)" },
      ]},
      { key: "value", type: "text", label: "Constant value", when: s => s.strategy === "constant" },
    ],
    toLabel: s => `fill_na ${s.col} ← ${s.strategy}${s.strategy === "constant" ? ` (${s.value})` : ""}`,
    defaultStep: () => ({ type: "fill_na", col: "", strategy: "mean", value: "" }),
  },

  {
    type: "type_cast",
    label: "Cast type",
    category: "cleaning",
    description: "Convert a column to a different data type. Unparseable values become null.",
    schema: [
      { key: "col", type: "col",    label: "Column" },
      { key: "to",  type: "select", label: "Target type", options: [
        { value: "number",  label: "Number" },
        { value: "string",  label: "String (text)" },
        { value: "boolean", label: "Boolean (0/1)" },
      ]},
    ],
    toLabel: s => `cast ${s.col} → ${s.to}`,
    defaultStep: () => ({ type: "type_cast", col: "", to: "number" }),
  },

  {
    type: "quickclean",
    label: "Normalize text case",
    category: "cleaning",
    description: "Standardize text casing in a string column.",
    schema: [
      { key: "col",  type: "col",    label: "Column" },
      { key: "mode", type: "select", label: "Mode", options: [
        { value: "lower", label: "lowercase" },
        { value: "upper", label: "UPPERCASE" },
        { value: "title", label: "Title Case" },
      ]},
    ],
    toLabel: s => `quickclean ${s.col} → ${s.mode}`,
    defaultStep: () => ({ type: "quickclean", col: "", mode: "lower" }),
  },

  {
    type: "recode",
    label: "Recode values",
    category: "cleaning",
    description: "Replace specific values in a column using a lookup map.",
    schema: [
      { key: "col", type: "col", label: "Column" },
      { key: "map", type: "map", label: "Value map (old → new)" },
    ],
    toLabel: s => `recode ${s.col} (${Object.keys(s.map || {}).length} rules)`,
    defaultStep: () => ({ type: "recode", col: "", map: {} }),
  },

  {
    type: "normalize_cats",
    label: "Normalize categories",
    category: "cleaning",
    description: "Unify variant spellings of categorical values (e.g. 'arg', 'ARG', 'Argentina' → 'Argentina'). Usually populated automatically by the fuzzy scanner.",
    schema: [
      { key: "col", type: "col", label: "Column" },
      { key: "map", type: "map", label: "Canonical map (variant → canonical)" },
    ],
    toLabel: s => `normalize_cats ${s.col} (${Object.keys(s.map || {}).length} mappings)`,
    defaultStep: () => ({ type: "normalize_cats", col: "", map: {} }),
  },

  {
    type: "winz",
    label: "Winsorize",
    category: "cleaning",
    description: "Clip extreme values to percentile bounds. Bounds are computed at step-creation time for reproducibility.",
    schema: [
      { key: "col", type: "col",    label: "Column" },
      { key: "lo",  type: "number", label: "Lower bound (p1 value)" },
      { key: "hi",  type: "number", label: "Upper bound (p99 value)" },
      { key: "nn",  type: "text",   label: "Output column name" },
    ],
    toLabel: s => `winsorize ${s.col} [${s.lo}, ${s.hi}] → ${s.nn || s.col}`,
    defaultStep: () => ({ type: "winz", col: "", lo: 0, hi: 0, nn: "" }),
  },

  {
    type: "ai_tr",
    label: "AI transform",
    category: "cleaning",
    description: "Apply an AI-generated JavaScript transformation to a column.",
    schema: [
      { key: "col", type: "col",  label: "Column" },
      { key: "js",  type: "text", label: "JS expression (value, rowIndex) => newValue" },
    ],
    toLabel: s => `ai_transform ${s.col}`,
    defaultStep: () => ({ type: "ai_tr", col: "", js: "" }),
  },

  // ── FEATURES ────────────────────────────────────────────────────────────────

  {
    type: "log",
    label: "Log transform",
    category: "features",
    description: "Natural log of a numeric column. Values ≤ 0 → null.",
    schema: [
      { key: "col", type: "col",  label: "Column" },
      { key: "nn",  type: "text", label: "Output column name" },
    ],
    toLabel: s => `log(${s.col}) → ${s.nn}`,
    defaultStep: () => ({ type: "log", col: "", nn: "" }),
  },

  {
    type: "sq",
    label: "Square",
    category: "features",
    description: "Square a numeric column (x²). Useful for quadratic terms.",
    schema: [
      { key: "col", type: "col",  label: "Column" },
      { key: "nn",  type: "text", label: "Output column name" },
    ],
    toLabel: s => `${s.col}² → ${s.nn}`,
    defaultStep: () => ({ type: "sq", col: "", nn: "" }),
  },

  {
    type: "std",
    label: "Standardize",
    category: "features",
    description: "Z-score standardization: (x − μ) / σ. μ and σ computed at step-creation time.",
    schema: [
      { key: "col", type: "col",    label: "Column" },
      { key: "mu",  type: "number", label: "Mean (μ)" },
      { key: "sd",  type: "number", label: "Std dev (σ)" },
      { key: "nn",  type: "text",   label: "Output column name" },
    ],
    toLabel: s => `standardize ${s.col} → ${s.nn}`,
    defaultStep: () => ({ type: "std", col: "", mu: 0, sd: 1, nn: "" }),
  },

  {
    type: "dummy",
    label: "Dummy encode",
    category: "features",
    description: "One-hot encode a categorical column. Creates one binary column per category.",
    schema: [
      { key: "col", type: "col",  label: "Column" },
      { key: "pfx", type: "text", label: "Column prefix" },
    ],
    toLabel: s => `dummy ${s.col} (prefix: ${s.pfx})`,
    defaultStep: () => ({ type: "dummy", col: "", pfx: "" }),
  },

  {
    type: "lag",
    label: "Lag",
    category: "features",
    description: "Lag a variable by n periods. Groups by entity column to prevent cross-unit contamination.",
    schema: [
      { key: "col", type: "col",    label: "Column" },
      { key: "n",   type: "number", label: "Periods (n)" },
      { key: "ec",  type: "col",    label: "Entity column (panel)" },
      { key: "tc",  type: "col",    label: "Time column (panel)" },
      { key: "nn",  type: "text",   label: "Output column name" },
    ],
    toLabel: s => `L${s.n || 1}.${s.col} → ${s.nn}`,
    defaultStep: () => ({ type: "lag", col: "", n: 1, ec: "", tc: "", nn: "" }),
  },

  {
    type: "lead",
    label: "Lead",
    category: "features",
    description: "Lead a variable by n periods (forward-shift). Groups by entity to prevent cross-unit contamination.",
    schema: [
      { key: "col", type: "col",    label: "Column" },
      { key: "n",   type: "number", label: "Periods (n)" },
      { key: "ec",  type: "col",    label: "Entity column (panel)" },
      { key: "tc",  type: "col",    label: "Time column (panel)" },
      { key: "nn",  type: "text",   label: "Output column name" },
    ],
    toLabel: s => `F${s.n || 1}.${s.col} → ${s.nn}`,
    defaultStep: () => ({ type: "lead", col: "", n: 1, ec: "", tc: "", nn: "" }),
  },

  {
    type: "diff",
    label: "First difference",
    category: "features",
    description: "First difference Δx = x_t − x_{t-1}. Groups by entity column for panel data.",
    schema: [
      { key: "col", type: "col",  label: "Column" },
      { key: "ec",  type: "col",  label: "Entity column (panel)" },
      { key: "tc",  type: "col",  label: "Time column (panel)" },
      { key: "nn",  type: "text", label: "Output column name" },
    ],
    toLabel: s => `Δ${s.col} → ${s.nn}`,
    defaultStep: () => ({ type: "diff", col: "", ec: "", tc: "", nn: "" }),
  },

  {
    type: "ix",
    label: "Interaction term",
    category: "features",
    description: "Multiply two numeric columns: c1 × c2.",
    schema: [
      { key: "c1", type: "col",  label: "Column A" },
      { key: "c2", type: "col",  label: "Column B" },
      { key: "nn", type: "text", label: "Output column name" },
    ],
    toLabel: s => `${s.c1} × ${s.c2} → ${s.nn}`,
    defaultStep: () => ({ type: "ix", c1: "", c2: "", nn: "" }),
  },

  {
    type: "did",
    label: "DiD interaction",
    category: "features",
    description: "Difference-in-differences interaction: treat × post. Both columns must be binary (0/1).",
    schema: [
      { key: "tc", type: "col",  label: "Treatment column" },
      { key: "pc", type: "col",  label: "Post column" },
      { key: "nn", type: "text", label: "Output column name" },
    ],
    toLabel: s => `DiD ${s.tc} × ${s.pc} → ${s.nn}`,
    defaultStep: () => ({ type: "did", tc: "", pc: "", nn: "" }),
  },

  {
    type: "date_extract",
    label: "Extract date parts",
    category: "features",
    description: "Extract year, month, day-of-week, or weekend indicator from a date column.",
    schema: [
      { key: "col",   type: "col",   label: "Date column" },
      { key: "parts", type: "parts", label: "Parts to extract",
        options: [
          { value: "year",      label: "Year" },
          { value: "month",     label: "Month (1–12)" },
          { value: "dow",       label: "Day of week (0=Sun)" },
          { value: "isweekend", label: "Is weekend (0/1)" },
        ]
      },
    ],
    toLabel: s => `date_extract ${s.col} [${(s.parts || []).join(", ")}]`,
    defaultStep: () => ({ type: "date_extract", col: "", parts: [], names: {} }),
  },

  {
    type: "mutate",
    label: "Mutate (expression)",
    category: "features",
    description: "Create a new column using a free-form expression. Column names and math helpers (log, ifelse, case_when…) are available as variables.",
    schema: [
      { key: "nn",   type: "text", label: "Output column name" },
      { key: "expr", type: "text", label: "Expression (e.g. log(wage) * educ)" },
    ],
    toLabel: s => `mutate ${s.nn} = ${s.expr}`,
    defaultStep: () => ({ type: "mutate", nn: "", expr: "" }),
  },

  // ── RESHAPE ─────────────────────────────────────────────────────────────────

  {
    type: "arrange",
    label: "Sort rows",
    category: "reshape",
    description: "Sort the dataset by a column, ascending or descending.",
    schema: [
      { key: "col", type: "col",    label: "Column" },
      { key: "dir", type: "select", label: "Direction", options: [
        { value: "asc",  label: "Ascending ↑" },
        { value: "desc", label: "Descending ↓" },
      ]},
    ],
    toLabel: s => `sort ${s.col} ${s.dir || "asc"}`,
    defaultStep: () => ({ type: "arrange", col: "", dir: "asc" }),
  },

  {
    type: "group_summarize",
    label: "Group & summarize",
    category: "reshape",
    description: "Collapse rows to one per group. Equivalent to dplyr group_by() |> summarize().",
    schema: [
      { key: "by",   type: "cols", label: "Group by columns" },
      { key: "aggs", type: "aggs", label: "Aggregations",
        fnOptions: [
          { value: "mean",   label: "Mean" },
          { value: "sum",    label: "Sum" },
          { value: "count",  label: "Count" },
          { value: "min",    label: "Min" },
          { value: "max",    label: "Max" },
          { value: "sd",     label: "Std dev (sample)" },
          { value: "median", label: "Median" },
        ]
      },
    ],
    toLabel: s => `group_by [${(s.by || []).join(", ")}] summarize (${(s.aggs || []).length} aggs)`,
    defaultStep: () => ({ type: "group_summarize", by: [], aggs: [] }),
  },

  // ── MERGE ───────────────────────────────────────────────────────────────────

  {
    type: "join",
    label: "Join dataset",
    category: "merge",
    description: "Left or inner join against another loaded dataset on a key column.",
    schema: [
      { key: "rightId",  type: "text",   label: "Right dataset ID" },
      { key: "leftKey",  type: "col",    label: "Left key column" },
      { key: "rightKey", type: "text",   label: "Right key column" },
      { key: "how",      type: "select", label: "Join type", options: [
        { value: "left",  label: "Left join (keep all left rows)" },
        { value: "inner", label: "Inner join (matched rows only)" },
      ]},
      { key: "suffix", type: "text", label: "Suffix for duplicate columns (default: _r)" },
    ],
    toLabel: s => `${s.how || "left"}_join ← ${s.rightId} on ${s.leftKey} = ${s.rightKey}`,
    defaultStep: () => ({ type: "join", rightId: "", leftKey: "", rightKey: "", how: "left", suffix: "_r" }),
  },

  {
    type: "append",
    label: "Append dataset",
    category: "merge",
    description: "Vertical stack (UNION ALL) with another dataset. Columns matched by name; unmatched columns filled with null.",
    schema: [
      { key: "rightId", type: "text", label: "Dataset to append" },
    ],
    toLabel: s => `append ← ${s.rightId}`,
    defaultStep: () => ({ type: "append", rightId: "" }),
  },

];

// ─── LOOKUP HELPERS ───────────────────────────────────────────────────────────

/** Get registry entry by step type. Returns undefined if not found. */
export function getStepDef(type) {
  return STEP_REGISTRY.find(s => s.type === type);
}

/** Get all step definitions for a category. */
export function getStepsByCategory(category) {
  return STEP_REGISTRY.filter(s => s.category === category);
}

/** Produce a human-readable label for any step object. Falls back gracefully. */
export function stepLabel(step) {
  const def = getStepDef(step.type);
  if (!def) return step.type;
  try { return def.toLabel(step); } catch { return def.label; }
}

/** Produce a valid default step object for a given type. */
export function defaultStep(type) {
  const def = getStepDef(type);
  if (!def) throw new Error(`Unknown step type: ${type}`);
  return def.defaultStep();
}

/** All registered step types as a flat array. */
export const STEP_TYPES = STEP_REGISTRY.map(s => s.type);
