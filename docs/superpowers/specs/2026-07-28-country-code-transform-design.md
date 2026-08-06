# Country code transform — design

Date: 2026-07-28
Status: OPEN (spec approved by Franco, implementation plan not yet written)

## Purpose

R's `countrycode` package is a routine step in econometrics workflows that mix
country-level datasets (World Bank, UN, OECD, custom panel data) — datasets
name countries inconsistently ("USA", "United States", "US"), and a common
key (typically ISO3) is needed before a `join`. Litux fetches World Bank data
(`iso3` + `name`) but has no local country-code reference table or conversion
step. This adds one.

Confirmed with Franco during brainstorming: the primary driver is **adding a
derived column** (convert an existing country identifier to another format),
which implicitly also solves the harmonization-before-join case — a
dedicated "join key harmonizer" UI is explicitly out of scope for v1.

## Scope (v1)

- Formats: ISO2 ↔ ISO3 ↔ English name only. No continent/region, no ISO
  numeric (M49) — explicitly deferred.
- Universe: ISO 3166-1 sovereign states + the handful of non-sovereign
  entities World Bank already treats as separate economies (Taiwan, Hong
  Kong SAR, Macao SAR, Kosovo) — same ~217-entry universe
  `worldBank.js#listCountries()` already returns, so a World-Bank-fetched
  dataset and a locally-typed one land on the same key space.
- Matching: broad curated alias dictionary (case-insensitive, common
  abbreviations, historical names e.g. Swaziland → Eswatini), no
  regex/fuzzy-distance. Exact match against the alias table only — same
  philosophy as the existing `fuzzyGroups` guard against false-positive
  grouping.
- Unmatched values: output `null` in the new column; the UI surfaces an
  unmatched count + the offending values before the user applies the step.

## Architecture

### Reference table — `src/services/data/countryCodes.js` (new, pure JS)

- `COUNTRY_TABLE`: array of `{ iso2, iso3, name, aliases: string[] }`, ~217
  entries.
- `matchCountry(rawValue) → { iso2, iso3, name } | null`: trims +
  case-folds `rawValue` and looks it up against every code/name/alias in the
  table.
- **UI-time only.** Nothing in `runner.js`, `stepTranslators.js`, or any
  export path imports this file — see below.

### Pipeline step — reuses the `recode`/`normalize_cats` pattern, not new runtime logic

Precedent: `normalize_cats` already resolves fuzzy-matched category groups
**once, in the UI**, and freezes the result into a literal `step.map` before
`onAdd()` — the runner and every exporter then just apply an exact-match
dictionary. `country_code` follows exactly the same shape:

1. UI calls `matchCountry()` once per **distinct value currently in the
   column**, builds `map: { rawValue: resolvedCode | ... }` (only matched
   entries go in; unmatched are simply absent from `map`).
2. `onAdd({ type: "country_code", col, nn, destination, map, desc })`.
3. `runner.js` new case, same shape as `log`/`sq` (adds column `s.nn`
   instead of overwriting): looks up `String(v)` in `s.map`, `null` if
   absent, `H = [...H, s.nn]` if not already present.

This means the alias table and matching logic **never appear at runtime or
in exported scripts** — the same isolation `normalize_cats` already relies
on, and it avoids introducing a second "logic recomputed differently in two
places" risk (the class of bug flagged in CLAUDE.md's PartialPlot /
noIntercept entries).

- `registry.js`: `type: "country_code"`, `category: "features"`,
  `internal: true` (excludes it from the NL catalogue via
  `serializeAllowedSteps`'s existing `if (s.internal) continue;` check —
  same mechanism already used to keep `sp_*` spatial steps and cell-edit
  `patch` steps out of the AI's reach; the AI cannot safely fabricate `map`
  without the dataset's real distinct values). `schema: [col, nn,
  destination, map]`, `toLabel` for History.jsx.
- `auditor.js`: new `case "country_code"` → human-readable line, e.g.
  `"Country code: {col} → {nn} ({destination}), {n} unmatched"`.

### Export (R / Python / Stata) — same shape as `recode`'s translators

Difference from `recode`: writes to a new column (`nn`), and unmatched stays
missing rather than falling back to the original value.

- R: `df <- df |> mutate(nn = dplyr::case_match(col, "USA" ~ "USA", "United States" ~ "USA", ..., .default = NA_character_))`
- Python: `df["nn"] = df["col"].map({...})` — no `.fillna()` needed, since an
  unmapped key already yields `NaN` from `.map()`.
- Stata: `generate nn = ""` then one `replace nn = "..." if col=="..."` per
  matched entry; unmatched rows stay Stata-missing by omission.

## UI (FeatureTab.jsx)

New dedicated subsection (own state block, same weight as the existing
"Date Extraction" section — not a one-line addition to the "Quick
Transform" dropdown, because it needs a destination selector and a
mandatory preview):

1. Source column selector (any column, not just numeric).
2. Destination selector: ISO2 / ISO3 / Name (chip/radio group, matching
   `InferenceOptions`' chip style).
3. New column name, auto-suggested (`${col}_iso3` etc.), editable — same
   `suggestName` convention as the other transforms.
4. **Preview**, automatic on column/destination change (no separate button):
   distinct values → resolved value, plus a summary line
   ("38/40 matched · 2 unmatched: <value1>, <value2>"). The user sees this
   before deciding to apply. **Distinct values must come from the full
   dataset, not the 500-row JS preview** — via `SELECT DISTINCT col FROM
   {duckdbTableName}` when a DuckDB table is active, JS fallback otherwise
   (same `if (duckdbTableName) { ... } else { ... }` shape the `std`
   transform already uses in this file for column stats). Otherwise an
   unmatched value that only occurs past row 500 would silently miss the
   preview and still end up `null` post-Apply with no warning — the
   project's "display limit ≠ computation limit" invariant applies here.
5. **Apply**: freezes the previewed resolution into `map`, calls `onAdd`.

## Validation

Not an econometric engine, so the R-benchmark harness (6dp coef / 4dp SE)
doesn't apply. Instead: a small integrity script,
`src/services/data/__validation__/countryCodesValidation.mjs`, checking (a)
no duplicate iso2/iso3 keys in `COUNTRY_TABLE`, (b) no alias claimed by two
different countries, (c) `matchCountry()` resolves a fixed list of known
tricky cases (case variants, "USA"/"U.S.", recent renames like
Eswatini/Swaziland, Czechia/Czech Republic).

## Out of scope (v1)

- Continent / region / numeric ISO output.
- Fuzzy/Levenshtein matching beyond the curated alias table.
- Exposing `country_code` to the NL command bar / AI coach.
- A dedicated "harmonize join keys" UI distinct from the Feature-tab
  transform (the transform covers this today: convert both sides to ISO3,
  then join).
