# IDEAS
Hi Claude, this is a document where all my ideas are saved so I don't forget none of them. We will discuss them to see how plausible they are, considering the current code structure, you will grade the feasibility from 1 to 6, 1 impossible, 6 easy implementation. 

Freeform scratchpad — dump anything here, no structure required. Edit from
GitHub's web UI on the go, `git pull` locally to sync back.
Ideas have different status: NONE (if not discussed nor processed), REJECTED, ACCEPTED (If it will be implemented), PROCESSED (if discussed but nothing decided). Every change must have the date of update. Ideas can have examples if necessary.

---

# Idea 1
We might exploite the right click, adding some functions or copy options to it, that is a very underrated and confortable option for users, this is a general idea and very polivalent.
Feasibility: 5
Notes: there is not a single `onContextMenu` handler in `src/` today, so this is greenfield — but the payload already exists. `ColCard` (CleanTab.jsx:506) renders a `⋯` dropdown with rename/filter/cast/distinct/drop. Binding right-click to that same menu is one handler plus positioning. The real cost is that the menu is hardcoded inline inside `ColCard`; reusing it on the Data Viewer, Explore and Model requires extracting a shared `<ContextMenu>` primitive first. Converges with Ideas 3, 5 and 6 on that primitive.
Status: PARKED — awaiting Franco's simplification pass
Date: 06-08-26
Parked 06-08-26: design started, then Franco parked it to first work out where the UI actually needs simplifying — the shortcut is only worth building once it is clear what it replaces. Two findings from that session worth keeping: the codebase has exactly ONE dropdown pattern today (`ColCard`'s `⋯`), so a shared `<ContextMenu>` has no competing precedent to reconcile; and the registry's 64 non-internal steps split into three groups that need very different menu treatment — parameterless (`drop`, distinct, `drop_na` on this column), form-opening (`rename`, `filter`, `type_cast`, `recode`), and not-a-single-column at all (`join`, `pivot_longer`, `group_summarize`), which do not belong on a column menu.
# Idea 2
The guide tour must be upgraded, we have introduced many features and reorganized some sections, so users must be guided in detail. The "How to ..." manuals must be updated as well.
Feasibility: 6 (copy refresh) / 4 (spotlight)
Notes: the premise is partly stale — `TOUR_STEPS` (HelpSystem.jsx:11) has 9 entries and the copy is current as of the 30-07 audit (it already names CR2/CR3, Sun-Abraham, Callaway-Sant'Anna, `.RData`, DuckDB routing). Rewriting copy is trivial. The actual gap is structural: the tour is a floating card that switches tabs but never points at anything on screen. Anchoring each step to a real DOM element with a spotlight needs a per-step ref registry, which is the 4.
Status: PROCESSED
Date: 03-08-26
# Idea 3
Also widely general, but we can implement a lot of Power BI tools into Litux for the Data Viewer and for Clean section, when it comes to data preparation and cleaning.
Examples: Add most of the dplyr functions to the right click, so the UI is cleaner and users can apply the functions basically everywhere.
Feasibility: 5 (surface existing steps) / 3 (true BI-grade surface)
Notes: cheaper than it sounds — `runner.js` already implements 54 step types, so most dplyr verbs exist; the work is exposing them, not writing them. Hard constraint: every menu action must emit a pipeline step, never mutate the table in place (non-destructive invariant). Drops to 3 if "Power BI" means calculated measures and aggregation panes, which is a new surface rather than a new entry point to existing steps. Depends on Idea 1's `<ContextMenu>` primitive.
Status: PARKED — same reason as Idea 1, they share the primitive
Date: 06-08-26
# Idea 4
We can increase the AI comands to apply not just in the Clean section, but in all of them, allowing the users to ask for summarized tables, running regressions with subsets, building plots, etc. This might be unnecessary because Litux is already very intuitive, but just to consider.
Feasibility: 3
Notes: `NLCommandBar`'s contract is NL → pipeline steps validated against `STEP_REGISTRY` (stepValidator.js). That works in Clean because the output *is* a step. In Explore and Model the output is a different type (plot spec, model spec), so each target needs its own schema, its own validator and its own prompt — three parallel builds, not one reuse. Your own doubt holds for Model; the case that does pay is Plot Builder, where layer configuration is genuinely fiddly.
Status: PROCESSED
Date: 03-08-26
# Idea 5
Add multipanel/multiwindows displays, like we did with the distinct function, if we orginze them properly, the UI can be much cleaner and confortable for users, and looks more professional.
Example: pinned plots are opened in a separate window display, just like in R we have the plot viewer.
Feasibility: 5 (in-page floating panels) / 1 (real OS windows)
Notes: `DistinctValuesPanel.jsx` is already exactly this pattern — `position:fixed`, minimizable, non-modal, z-index 900, deliberately non-blocking so it stays visible while you work elsewhere. Generalizing it into a `<FloatingPanel>` shell plus a panel manager (stacking, position memory) is contained. Real OS windows are the 1: `window.open` appears nowhere in the codebase and would sever the React tree, the inline-style theming and the DuckDB singleton. `SplitDivider.jsx` already covers the 2-pane split case.
Status: DONE 06-08-26
Date: 06-08-26
Shipped: `<FloatingPanel>` + `PanelStack` + an app-scoped Artifact Viewer over the project's saved plots and maps; `DistinctValuesPanel` migrated onto the same shell (110 → 87 lines). Scope is the MOUNT POINT, not a prop. Deferred on purpose: maps/models show a summary card rather than a live render (Leaflet's lifecycle inside a resizing panel is its own hazard), and drag/resize stays out — it unstacks the panels and hands window management back to the user.
Spec: `docs/superpowers/specs/2026-08-03-floating-panels-design.md`. v1 = a reusable `<FloatingPanel>` + `PanelStackContext`, with two consumers at opposite scopes: a new app-scoped Artifact Viewer (saved plots/maps/models, navigated ◀ ▶ over the order `artifactOrder.js` already persists) and the migrated module-scoped Distinct Values panel. One note on your own reference: RStudio's Plots pane is **not** N floating windows, it is ONE pane with history — which is what the design follows, since free-floating windows hand window management back to the user, the opposite of the cleaner UI you were after.
# Idea 6
We can improve the data viewer to simulate an excel or PowerBI tools
Example: filter values to change the specific rows
Feasibility: 5
Notes: much of this already shipped. `DataViewer` (App.jsx:415) has header-click sort (asc→desc→off), a view-level filter with 8 operators, inline cell editing, fill-column, add column/row, set-where, find/replace, string splice, rounding and DuckDB-backed paging. The genuine gaps vs Excel are: the filter is one column at a time (no stacking), there is no per-header autofilter dropdown with value checkboxes, and columns cannot be frozen, reordered or resized. The autofilter can reuse `getDistinctValues()` from duckdb.js — the same query `DistinctValuesPanel` already runs.
Status: PARTIAL 06-08-26 — the bug is fixed, the autofilter is not built
Date: 06-08-26
Done: the §8 correctness bug — the Data Viewer filtered the 500-row preview and reported "3 of 500" for a 900k-row table. It now compiles through `predicateToSQL` and runs on the full table, with a banner (never a silent preview-filter) when a filter cannot be pushed down. Still open: the per-header autofilter dropdown with value checkboxes, and stacking filters across several columns. Both are cheaper now — the canonical predicate and the `in` operator they need already exist.
Spawned: grading this idea surfaced a bigger problem underneath it — the same "compare a column against something" operation is spelled five different ways across the UI (Explore shows `=`, SubsetManager shows `==`, Clean says "is null", the Data Viewer says "empty") and implemented six times in code. Franco's call: unify that first so the autofilter is built once, already speaking the canonical language. Spec: `docs/superpowers/specs/2026-08-03-unified-condition-language-design.md`. The autofilter's own design decisions are recorded in that spec's §8, along with a shipping bug it must fix — the Data Viewer's filter currently runs against the 500-row preview, so filtering a 900k-row DuckDB table silently filters the first 500 rows and presents that as the whole table.


