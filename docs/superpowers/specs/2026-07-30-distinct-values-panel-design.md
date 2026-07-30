# Distinct values panel — design

Date: 2026-07-30
Status: OPEN (spec approved by Franco, implementation plan not yet written)

## Purpose

From today's Supabase feedback batch (2026-07-28): "Add a function to print
a list with all the distinct values of a variable, e.g. a user wants to see
the names in 'Country' or 'Continent'." A read-only inspection utility, not
a pipeline step or data transform.

## Scope

- Lives in Clean > Formatting (FeatureTab.jsx), alongside the other
  per-column tools already there.
- Column picker (any column, not just numeric) + a "View distinct values"
  button.
- Query runs against the **full dataset**, not the 500-row JS preview —
  this project's "display limit ≠ computation limit" invariant.

## Architecture

### Query — `getDistinctValues(tableName, col)` in `services/data/duckdb.js`

Same shape as the existing `computeColStats` (used by the `std` transform):

```sql
SELECT "col", COUNT(*) AS n
FROM table
WHERE "col" IS NOT NULL
GROUP BY "col"
ORDER BY n DESC
LIMIT 500
```

- Sorted by frequency descending (most common value first) — the standard
  EDA convention (`dplyr::count(sort = TRUE)`).
- Capped at 500 distinct values. If the column has more, the panel shows
  "top 500 of N distinct values" rather than rendering an unusable list for
  a near-unique ID column.
- JS fallback (`Map` + sort) when no DuckDB table is active for the current
  dataset, matching the existing `if (duckdbTableName) { ... } else { ... }`
  pattern already used by the `std` transform in `FeatureTab.jsx`.

### UI — a floating, non-modal, minimizable panel (not the existing modal pattern)

The existing full-screen dimmed-overlay modal (`AuditTrail.jsx`'s pattern,
`position: fixed; inset: 0`) is the wrong shape here: it blocks the rest of
the UI, and this panel's whole point is to stay visible as a reference
*while* the user keeps working elsewhere (e.g. building a `country_code`
mapping, per the overlap already noted in the country-code-transform spec).
This is a new, small UI pattern for the app — not a reuse of an existing
component.

- Anchored floating panel (e.g. bottom-right corner), does not dim or block
  the rest of the screen.
- Title bar: column name + distinct-value count, a minimize toggle, and a
  close (✕) button.
- **Expanded**: title bar + scrollable two-column list (value · count).
- **Minimized**: only the title bar renders (a "pill"), same width; clicking
  it (or the toggle) restores the expanded view.
- The DuckDB/JS query result is cached in component state — minimizing does
  not re-query; only clicking "View distinct values" for a **different**
  column re-queries and replaces the panel's content.
- Single instance: opening the panel for another column while one is
  already open replaces its content rather than stacking a second panel.
  If the panel was minimized when a new column is requested, it re-expands
  — the user just took an action to view something, so it shouldn't stay
  hidden.
- No drag/resize — fixed position and size. No copy/export button for this
  version.

## Testing / validation

Not a math engine, so the R-benchmark harness doesn't apply. Manual check:
confirm the count matches `SELECT COUNT(DISTINCT col)` for a known column,
and confirm the panel keeps working (state preserved) when minimized and
restored, and when switching tabs within Clean and back.

## Out of scope

- Copy-to-clipboard / export of the list.
- Draggable or resizable window chrome.
- Multiple simultaneous panels for different columns.
- Continent/region derived views (that's the country-code-transform spec's
  territory, not this one).
