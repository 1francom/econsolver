# Fase X5 — Bug Bash + UX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Track:** C — Cross-cutting hardening
**Status:** Queued. **Last fase before launch gate.**
**Blocks:** launch.

**Goal:** Reconcile `BugTriage.md` and `ClaudeFB.md` against the live codebase, close every open row with either a fix or a documented wontfix, and finish UX polish (tour coverage, hint boxes, color/typography consistency).

**Why this matters:** docs lag behind reality (per project memory). Many "open" bugs are already fixed; some "fixed" bugs have regressed. Without a sweep, the launch ships with phantom-open issues in the public-facing roadmap and missed real ones.

**Tech Stack:** Read-and-verify against `git log`, `git blame`, and the current code. `feedback-collector` agent for Supabase pull. `feedback-analyst` agent for mapping rows → source files. No new infrastructure.

---

## Task 0 — Run feedback-collector first

**Before doing anything else**, dispatch the `feedback-collector` agent to drain unprocessed Supabase rows into `ClaudeFB.md`. This fase's whole purpose is reconciliation — you need the freshest data.

```
Agent({ subagent_type: "feedback-collector",
        description: "Drain Supabase feedback table for X5 sweep",
        prompt: "Pull every unprocessed row, append to ClaudeFB.md grouped by type, mark rows processed. Report count drained." })
```

Then run `feedback-analyst` to attach file paths and suggested fix locations to every open row.

---

## Task 1 — BugTriage.md sweep

Read `BugTriage.md`. For every row marked "open":

1. **Verify against code.** Search for the symptom — function names, error strings, screenshots. Use the code-review-graph MCP first (`semantic_search_nodes_tool`, `query_graph_tool`), then Grep as fallback.
2. **Triage outcome:**
   - **Already fixed** (most common per memory): mark `RESOLVED — verified at commit <hash>` and move to closed section.
   - **Reproducible:** assign to a fix-now or fix-later bucket.
   - **Cannot reproduce:** mark `STALE — could not reproduce on <date>`. Move to closed if 30+ days old.
   - **Wontfix:** document the rationale inline.

Output: every row in BugTriage.md is in one of these states. Open section is the live work list.

---

## Task 2 — ClaudeFB.md sweep

Read `ClaudeFB.md`. For every entry:

1. Match to the right fase:
   - Pipeline / wrangling → defer to Fase X1 (or fix here if already shipped).
   - Replication → defer to Fase X2.
   - AI / narrative → defer to Fase X3.
   - Performance / crash → defer to Fase X4.
   - Estimator-specific → defer to Fase 4b/5/6/7/8.
   - Module-specific (spatial, calculate, simulate, plots) → defer to V1–V4.
   - **None of the above** → fix in this fase.
2. Add a `Routed to: Fase <N>` annotation on every routed entry.
3. The remainder is the X5 fix list.

---

## Task 3 — Fix-now list execution

For each fix-now item:

1. Read the affected file.
2. Patch with a surgical `Edit` (no full rewrites — caveman method per project memory).
3. If a regression test would have caught it, add one in the relevant `__validation__` directory.
4. Commit individually so the changelog is readable.

---

## Task 4 — UX polish sweep

### Tour overlay coverage

`src/components/HelpSystem.jsx` has `TOUR_STEPS`. Verify every tab has at least one entry:

- Data, Clean, Explore, Model, Simulate, Calculate, Spatial, Report.

If any tab is missing, add a step pointing at the most important UI element on that tab.

### HintBox coverage

Each tab has a collapsible HintBox. Verify content is non-empty and accurate. Particular attention to tabs added recently (Spatial, Calculate, Simulate).

### Color / typography audit

Grep the codebase for raw hex literals (`#[0-9a-fA-F]{3,6}`). Every match must either be:
- A constant inside `shared.jsx` (`C` object).
- A documented exception (e.g. embedded SVG icon path).

Replace ad-hoc hex with `C.teal` / `C.gold` / `C.blue` / `C.bg`.

Same audit for fonts: every styled text element should resolve to IBM Plex Mono via `mono` from `shared.jsx`, except for explicit labels.

### Dark theme consistency

Spot-check every tab in the live UI:
- Background `C.bg` everywhere.
- No light-mode flashes on tab transition.
- Modal/popover backgrounds use a darker shade.

---

## Task 5 — CLAUDE.md "Pending" reconciliation

Walk the 10-item "Pending" list in CLAUDE.md. For each:

- If shipped, strike through and add a status line ("done in commit `<hash>`").
- If genuinely pending, leave in place.
- If superseded, document the replacement.

The launch gate requires items 1–10 marked done (per pre-launch roadmap).

---

## Acceptance gate

- [ ] `BugTriage.md` has zero unverified "open" rows.
- [ ] `ClaudeFB.md` has zero un-routed entries.
- [ ] All fix-now items shipped with commits.
- [ ] Tour overlay covers all 8 tabs.
- [ ] HintBox content present on all tabs.
- [ ] No raw hex literals outside `shared.jsx`.
- [ ] CLAUDE.md "Pending" 1–10 all closed.

---

## Pre-merge gate — Supabase feedback check (MANDATORY)

This fase **starts** with the Supabase pull (Task 0) — so the gate here is the **closing** check:

1. Re-run `feedback-collector` after all X5 fixes are committed.
2. Confirm any newly arrived rows are routed or fixed.
3. The live Supabase feedback table must have zero rows tagged with launch-blocking severity (`crash`, `data loss`, `silent wrong number`) when the gate fires.
4. The `Resolved` status in Supabase mirrors the `RESOLVED` status in `BugTriage.md` for every closed row.

If a critical row arrives during this fase, it preempts everything else.

---

## Commits

- `chore: Fase X5 — Supabase feedback drained and routed`
- `chore: Fase X5 — BugTriage sweep, N rows resolved`
- `fix: Fase X5 — individual fix commits, one per logical issue`
- `style: Fase X5 — UX polish (tour, hints, color, typography)`
- `docs: Fase X5 — CLAUDE.md Pending reconciled; launch gate fired`
