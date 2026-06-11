# Econ Studio — Final Product Architecture Plan

## Context

Econ Studio is transitioning from a feature-based tool to a professional SaaS product. Three interdependent features are required: a standardised estimator interface (foundation), an advanced context-aware AI coach, and a multi-model comparison system. The standardised interface must land first — the other two consume its uniform result shape.

---

## Status Legend
- DONE — file exists with required exports / feature fully wired
- IN PROGRESS — file exists but feature incomplete or not fully wired
- PENDING — not yet started
- BLOCKED — dependency missing

---

## Spec & Plan Index

> **RULE (see CLAUDE.md → "Planning & spec tracking"):** every spec/plan created under
> `docs/superpowers/specs/` or `docs/superpowers/plans/` gets a row here in the same change,
> with a status. Update the status when work lands or is dropped. This table is the single
> source of truth for what is specced vs shipped — so nothing gets orphaned again.
>
> Statuses below marked `(verify)` were backfilled from a code scan on 2026-06-01 and should be
> confirmed against the current codebase before being trusted as final.

| Date | Spec / Plan | Status | Notes |
|------|-------------|--------|-------|
| 2026-06-11 | `plans/2026-06-11-litux-website.md` | DONE (deploy pending Franco) | All 14 tasks executed 2026-06-11 via subagent-driven development (18+ commits). Site lives in SEPARATE repo `github.com/1francom/litux-site` (private; local `C:\Franco\litux-site`). Astro 5 + React islands; 9 Vitest tests green; 12 static pages + `/api/notify` server route; client bundle verified free of Supabase key leakage. Review fixes applied: one-shot tour reveal, aria-pressed/aria-current/aria-label/role=status a11y set, h2 step titles, simulate video entry, .env.example. **Franco's 4 pre-launch steps:** (1) import repo in Vercel + set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env BEFORE build; (2) create `desktop_waitlist` table (SQL in plan Task 12); (3) confirm `APP_URL` in `src/config.ts`; (4) browser-validate hero/tour/waitlist. Known follow-ups: ModuleTour blurbs + /start steps copy still in components (move to content files with i18n work); transparency section is cards not a drawn diagram. |
| 2026-06-11 | `specs/2026-06-11-litux-website-design.md` | DONE (content production pending) | Litux central website (landing + getting started + thematic video library + docs + downloads). Design fully approved by Franco in brainstorming session 2026-06-11: direction C (dark refined, motion/3D, teal/gold), hexagon L-axis logo (provisional), Glitzern pixel hero (3s, crossfade to smooth text), two-level tagline, 6-section home (tour→video merged, honest data-transparency reframe, "one analysis three scripts"), downloads ship as coming-soon + email capture (Tauri stays parked), English-only launch with i18n-ready content files, docs single-sourced with future in-app help. Implementation NOT started — separate repo recommended (Astro + React islands, decide in plan phase). |
| 2026-05-14 | `specs/2026-05-14-factor-variables-design.md` | DONE (verify) | `factor_interactions` step live in runner.js |
| 2026-05-17 | `specs/2026-05-17-ai-coach-dispatch-design.md` | DONE (browser-validation pending Franco) | Coach→Assistant dispatch built 2026-06-10, reconciled to current architecture (coach now STREAMS + `NLCommandBar`/`nlToPipeline` already shipped, so simpler than the original 8-step plan). Pieces: `COACH_DISPATCH_PROMPT` (Prompts/index.js) + `coachDispatch()` (AIService.js, routed to MODEL_FAST/haiku, JSON `{dispatch:{col,instruction,label}}|null`, col validated ∈ headers). Detection runs as a cheap parallel call AFTER the streamed reply (no streaming disruption); on a hit, a `DispatchButton` ("→ label") renders under that assistant message in `AIContextSidebar.jsx` (NOT a separate ResearchCoach.jsx — that file never existed; coach lives in AIContextSidebar). Click → `handleDispatchToAssistant` in App.jsx (navigate to Clean + `assistantPrefill{col,instruction,ts}` + close sidebar) → threaded App→DataStudio→WranglingModule→`NLCommandBar`, which auto-runs the NL→pipeline preview. Confirm-before-apply = NLCommandBar's existing preview + Apply/Discard. Build + lint:undef green. Franco: browser-validate the address-cleaning user story (ask coach in Spatial → dispatch button → Clean preview → apply). |
| 2026-05-19 | `specs/2026-05-19-duckdb-suffstats-roadmap-design.md` | DONE | DuckDB Fase 0–8 all complete + R-validated |
| 2026-05-21 | `specs/2026-05-21-pre-launch-roadmap.md` | ACTIVE (living launch spine — not a closeable deliverable) | Reconciled 2026-06-10. **Track A (estimator SQL push-down) Fases 0–8 all DONE** + R-validated (see DuckDB section). **Track C: X3 (AI hardening) DONE** (faseX3 harness). **Remaining:** Track B module-validation V1 spatial / V2 calculate / V3 simulation / V4 plots (R-validation harnesses — need Franco's R), and Track C X1 pipeline-reliability / X2 replication-integrity / X4 performance / X5 bug-bash+UX. **Fase X5 (bug bash + visual polish) = the upcoming feedback/visual pass.** Launch gate per §"Done criteria". |
| 2026-05-25 | `THREAT_MODEL.md` (security spec, K1–K10) | BLOCKED — remaining items auth-gated (auth deferred) or pre-contract | K3/K4/K6/K7 DONE (worker-sandboxed eval + CSP/SRI, server-side AI proxy, file-upload bounds). X3 AI-PII-filter DONE; §3.2 expr-sandbox hardening DONE (worker scrub + `assertSafeExpr` denylist at compile sites, incl. `calcEngine.evalExpression` 2026-06-10). **Remaining K2 (auth hardening) / K5 (HSTS+secure cookies) / K8 (session mgmt) / K9 (audit logging) all wait on auth, which is DEFERRED (Phase 13.2); K10 (OWASP pentest) is a pre-institutional-contract milestone.** Nothing actionable until auth lands. |
| 2026-06-05 | `specs/2026-06-05-cloud-sync-e2ee-design.md` | DONE (browser+advisor validation pending Franco) | Roadmap #4 Phase 4a-1 landed: opt-in E2EE sync module, Supabase migration file, IndexedDB sync metadata, sync engine with untrusted-pull guard, publish/unlock/conflict/restore UI, and auth logout key clearing. Locked implementation uses PBKDF2-SHA-256 (310k) + AES-256-GCM; sharing remains deferred (4a-2). Migration `supabase/migrations/202606061039_synced_projects.sql` is pending Franco review/apply + Supabase advisor. |
| 2026-06-05 | `specs/2026-06-05-local-persistence-completeness-design.md` | OPEN | Roadmap #4 decomposed → Phase 4b (local only): persist pinned-model buffer + spatial maps to IDB (v8→v9), shared `trimResult`, restore on project open; verify plots/equations restore. Local-by-default; opt-in cloud sync + E2EE is Phase 4a (later). Plan `plans/2026-06-05-local-persistence-completeness.md` (7 tasks). **DONE (browser-validation pending)**: pinned-model buffer + Map-tab layer config persisted to IDB v9; trimResult harness 7/7; plots+equations restore verified already-wired (Part C no-op). Follow-ups: SpatialGeoPlot live-config persistence; full modeling-session restore. Claude track |
| 2026-06-05 | `specs/2026-06-05-expr-sandbox-hardening-design.md` | DONE (browser-validation pending) | Closed THREAT_MODEL §3.2 HIGH. Worker-scrub network globals + `exprGuard.assertSafeExpr` denylist at all compile sites; vector_assign-conditional routed to worker; unsafe main-thread fallback removed; import + validateAISteps content-check; NLCommandBar shows expr. Harnesses: exprGuard 23/23, stepValidator 8/8, build clean. Residual: FormatTab regex char-class escape (low-sev, self-scoped) |
| 2026-05-22 | `plans/2026-05-22-fase-x3-ai-hardening.md` | DONE | PII strip before AI egress. **2026-06-08:** Task 3 partial — `inferVariableUnits` (dictionary auto-inference, broadest sample-value exposure) now routes sample rows through the sanctioned `privacyFilter.filterSampleRows` choke point with `detectPII` auto-detection: HIGH cols suppressed, MEDIUM aliased + values masked, aliases re-mapped to originals so non-PII inference quality is preserved; redaction logged to console. Verified `interpretRegression` is a no-row-data path (rows used only for binary 0/1 detection, never emitted). **REMAINING:** (a) scope decision for `wrangling/utils.js callAI` per-column Q&A path (`WRANGLING_QUERY_PROMPT`) — filtering raw sample values degrades the user-initiated Q&A feature, needs Franco's call; (b) Tasks 1/2/4/5/6 harnesses + fixtures (caching audit, model-routing, 100-var unit accuracy ≥95%, coef-narrative guardrails, LocalAI parity); (c) mandatory Supabase feedback gate before marking DONE. **2026-06-09:** (a) RESOLVED → option A: `wrangling/utils.js callAI` (both query + transform modes) now routes sample values through `detectPII`→`filterSampleRows` UNCONDITIONALLY (no user override) before egress — Franco's call, rationale: users may not realize a column Q&A/transform exposes raw cell values. Tasks 1/2/3/6 deterministic harness landed: `src/services/AI/__validation__/faseX3Validation.js` (mocks `globalThis.fetch`, exercises real AIService methods, asserts on captured bodies) self-registers `window.__validation.faseX3()` (auto-imported in main.jsx DEV block). Covers caching (SHARED_CONTEXT ephemeral block on every callClaude+streamClaude call, ≥1024-tok est, anthropic-beta header on direct path only — in proxy mode the header is added server-side so the client-verifiable invariant is the cached block), routing (corrected the plan's STALE model IDs → `haiku-4-5`=units / `sonnet-4-6`=narratives/cleaning/compare/nl / `opus-4-7`=coach specialist + sonnet stream), privacy (seeded-PII fixture: no raw PII in any outbound body + choke-point mechanism), LocalAI shape contracts (note: LocalAI is local heuristics, NOT a 1:1 mock of AIService — Task-6 reinterpreted as documented-shape contracts). Tasks 4/5 (live, non-deterministic, cost tokens, human-judged) → `faseX3LiveEval.js` + `faseX3UnitInferenceFixtures.json` (36-var seed toward 100) + `faseX3CoefNarrativeFixtures.json` (8 cases), gated behind `?validation=faseX3live`, run manually. Build + lint:undef green. **2026-06-09 (cont.):** harness surfaced 2 REAL bugs (its intended purpose), both fixed. (1) PRIVACY HOLE — `piiDetector.js` NAME_RULES used `\b…\b` word boundaries which fail on snake_case columns (`_` is a regex word char → `\bname\b` does not match `respondent_name`, `\bincome\b` misses `monthly_income`), so raw PII (`"Johnathan Smith"`, `5234.56`) leaked while only `contact_email` was caught via value-pattern. Fix: `detectPII` now normalizes column names (camelCase→spaces, `[_\-.]`→space) before the `\b` rules fire; verified all seed fixtures + `.?`-separator patterns (`social.?security`/`date.?of.?birth`/`ip.?addr`) still match. (2) CACHING INERT — `cache_control` sits on `system[0]`=SHARED_CONTEXT alone (~794 tok), below Anthropic's min cacheable prefix (1024 Sonnet/Opus, **2048 Haiku**); Anthropic silently skips sub-minimum blocks so prompt caching never engaged on any call, and unit inference (Haiku) needs 2048. Fix (Franco chose option A): grew SHARED_CONTEXT to ~2330 est tokens with STABLE invariant-reinforcing content (functional-form interpretation rules, significance/sign discipline, identification assumptions per design, SE-type/unit conventions, common pitfalls) — deliberately the same rules Tasks 4/5 grade, so the cache tokens also improve output adherence; `promptVersion` bumped 1→2 (cache-invalidating, intended). Harness `auditCaching` corrected: was asserting COMBINED system ≥1024; now asserts the CACHED BLOCK alone ≥ per-model min (2048 Haiku / 1024 else). Build + lint:undef green. **2026-06-09 (live eval run):** Franco ran harness → 23/23 green, and `window.__liveEval.faseX3()` (live, real API). Task 5 (narratives): clean — all 4 cases correct sign + significance (incl. p=0.046 marginal case correctly called significant at 5%), no fabricated metrics (CIs legitimately derived from supplied SE), causal-language discipline correct; the expanded SHARED_CONTEXT rules visibly working. Task 4 (units): first run read 29.7% (11/37) but this was a GRADER artifact — `inferVariableUnits` emits descriptive prose ("hourly wage in EUR") while fixtures stored compact canonical strings ("EUR per hour"), and the exact-match-after-normalize grader couldn't see word-order/synonym variants; ~34/37 answers were substantively correct on dimension. FIX (harness-only, no AIService change): replaced exact-match with DIMENSION-AWARE token-group grading — each fixture now carries an `accept` array of token-groups (AND across groups, OR within; substring match on normalized answer), `gradeUnit` in `faseX3LiveEval.js` requires every group satisfied. Re-grading Franco's actual outputs → 100% (37/37). Optional follow-up (B, deferred): tighten `INFER_UNITS_PROMPT` toward compact unit strings via prompt-engineer agent — product polish, not a correctness gate. Build + lint:undef green. **2026-06-09 (CLOSED):** Franco re-ran live eval on a fresh call → Task 4 = 100.0% (37/37) ≥95% ✓; Task 5 narratives clean ✓; harness 23/23 ✓. Feedback gate cleared via feedback-collector: 0 unprocessed Supabase rows (88 total, all processed), and the only AI-area tracked item (Poisson coefficient interpretation, BugTriage 2026-06-02) was already fixed 2026-06-03. All X3 acceptance criteria met → status DONE. Optional deferred polish (not a gate): tighten `INFER_UNITS_PROMPT` toward compact unit strings via prompt-engineer agent |
| 2026-05-30 | `specs/2026-05-30-equation-workbench-design.md` | DONE (browser-validation pending Franco) | Fully implemented: 11 components in `calculate/workbench/` (Workbench/Equations/Parameters/Conditions/Sweep/Results/Locus/Canvas/ViewControls/SessionTabs/EquationCard), v5 IDB store (`workbenchStore.js`), nerdamer + Pyodide/SymPy CAS backends, mounted `<Workbench pid>` in CalculateTab. **§10 security audit passed 2026-06-10:** §10.2 nerdamer `buildFunction` (AST, no globals); §10.3 SymPy `parse_expr` + fixed bootstrap, no exec/interpolation; §10.4 KaTeX `trust:false`, no innerHTML; §10.5 `workbenchStore` untrusted-on-read validation + live recompute. §10.1 gap CLOSED — `calcEngine.evalExpression` now calls `assertSafeExpr` (shared denylist) before compiling; workbench eval routes through `cas.compile` not evalExpression. Residual (low-sev, accepted): basic-calculator main-thread eval not worker-isolated (denylist-guarded, user-own input). Build + lint:undef green. |
| 2026-06-01 | `specs/2026-06-01-clean-tab-reorganization-and-report-ai-design.md` | DONE (verified 2026-06-10) | Part 1 (UI): FeatureTab subtabs = Shortcuts/Generate/Mutate/Conditional/Date/(Panel)/Formatting — Dummies removed, Numbers+Strings merged → "Formatting" (FeatureTab.jsx:721,928); top-level "Reshape & Merge" combined tab (WranglingModule.jsx:658). Part 2 (cross-module session log → Report AI): `SessionLogProvider` in App.jsx, `appendLog` fires across Calculate/Simulate/Spatial/StatWorkspace/QTE, `ReportingModule` threads `sessionLog` into `buildSessionSnapshot` (ReportingModule.jsx:964–967). |
| 2026-06-01 | `specs/2026-06-01-spatial-engine-gaps-design.md` | DONE (C5 R-validation pending Franco/R) | A4 expand_grid COVERED via `balance_panel`; Part A (areal interp, buffer exposure/count) + Part C (spatial weights, Moran/Geary, KDE, zonal, C5 spatial regression engine/UI) landed in `SpatialEngine.js` / `SpatialRegressionEngine.js` + UI sections, harnesses `spatialGapsValidation.js` and `spatialRegressionValidation.js`. **C5 audit 2026-06-08:** benchmarks were circular (engine-self-generated, all diffs=0 — never R-run). Fixed SAR/SDM β SE → full information-matrix numerical Hessian over (β,ρ) capturing β–ρ covariance (conditional SE understated; ρ SE unchanged = consistency check); SEM/SLX confirmed already correct (block-diagonal / OLS). Harness now warns when `meta.source!=="spatialreg"`; benchmark stamped `ENGINE_SELF_CHECK`. **C5 UI wiring verified 2026-06-08:** all 5 layers confirmed end-to-end — EstimatorSidebar (Spatial Reg. selectable), ModelConfiguration (`SpatialRegressionConfig`: SLX/SAR/SEM/SDM picker + W dropdown inline-geom/triples-dataset), ModelingTab (`resolveSpatialWeights`), `estimationDispatch.js` (`SpatialRegression` branch → `runSpatialRegressionFromRows`), EstimationResult (`wrapSpatialRegression` maps rho/lambda). **REMAINING: Franco runs `spatialRegressionRValidation.R` (spdep+spatialreg) to drop real R numbers + verify AIC/BIC parameter count (betas+spatial+σ²); then browser-validate** |
| 2026-06-01 | `specs/2026-06-01-modeling-poisson-twfe-gaps-design.md` | DONE (Part A+B; Part C C4–C7 deferred/opportunistic) | A1 two-way/N-way Poisson FE (`runPoissonFEMulti`) DONE + R-validated (coef 8dp vs fepois) + UI wired + browser-validated (2026-06-03). C3 Callaway-Sant'Anna DONE (2026-06-03). A2 (Sun-Abraham Poisson) DONE (confirmed in NonLinearEngine.js). A3 (interaction builder X1*X2) DONE 2026-06-09: expandInteractions in helpers.js, VariableSelector UI, spec enrichment in _runEstimation, R/Python/Stata formula builders. A4 (clustered SE multi-FE Poisson) DONE (inline in runPoissonFEMulti). **B1 (joint Wald test) DONE** — `waldTest()` in ModelHypothesis.js (χ²=(Rβ−h)′V⁻¹(Rβ−h), df=q, pchisq) + Single/Joint tabbed `CoefficientTestPanel.jsx` mounted in ModelingTab w/ liveResult + R/Py/Stata snippet (commit 8139cc5). **B2 (IRR/semi-elasticity) DONE** — resultDisplay.jsx IRR toggle (gated on log/Poisson): exp(β), `(exp(β)−1)·100` % effect, delta-method CI exp(β±z·SE) (commit 8139cc5). B3 mostly covered (ModelComparison/buffer/stargazer); formula-family generator = opportunistic. C1 NegBin FE DONE (commit acc652c). C2 offset-FE DONE. Remaining Part C C4 (CML Poisson), C5 (wild cluster bootstrap), C6 (AME/predict), C7 (LR/Wald nested-model stats) deferred/opportunistic. |
| 2026-06-01 | `specs/2026-06-01-descriptive-viz-gaps-design.md` | DONE | All shipped: A1 pivot_wider, A2 quantile group_summarize, A3 static choropleth fill-by-col+labels, B1 overdispersion panel (var/mean + Cameron-Trivedi CT z), B2 position_dodge for bar/point/errorbar in PlotBuilder, B3 Table-1 LaTeX+CSV export. C-track items (C1 KDE heatmap, C2-C8) remain deferred as originally scoped. |
| 2026-06-01 | `plans/2026-06-01-ba-thesis-replication-roadmap.md` | DONE (modeling gaps closed; Part C C4–C7 opportunistic) | Phase 3 A1 (multi-FE Poisson) fully DONE — R-validated + browser-validated 2026-06-03. Descriptive viz B1/B2/B3 DONE 2026-06-09. A2/A3/A4 DONE 2026-06-09. **Modeling B1 (joint Wald test) + B2 (IRR/semi-elasticity) DONE 2026-06-09** (commit 8139cc5) — see modeling-poisson-twfe-gaps row. All replication-blocking estimators now shipped. |
| 2026-06-04 | `specs/2026-06-04-ai-coach-persistence-streaming-design.md` | DONE | Per-project persisted multi-conversation coach (IDB v6 `coach_chats`) + `streamClaude` streaming/stop in AIService.js + `api/anthropic.js` SSE pass-through |
| 2026-06-04 | `plans/2026-06-04-ai-coach-persistence-streaming.md` | DONE | 9-task implementation plan for the coach persistence/streaming spec; lint+build+browser-validation gates (no JS test runner) — browser-validated incl. project-isolation fix |
| 2026-06-01 | `specs/2026-06-01-stat-sim-inference-deepening-design.md` | DONE | Spec A (data-level only): parametric tests (two-sample/paired/prop/corr/var-ratio), general bootstrap (perc/basic/BCa)+jackknife, generalized permutation, shared seeded RNG. Spec B (model-coef inference) deferred. (Math + harness green; browser validation of UI Tasks 11–13 pending Franco) |
| 2026-06-01 | `plans/2026-06-01-stat-sim-inference-deepening.md` | DONE | Implementation plan for Spec A: 14 tasks (rng.js, pf, 6 SampleTests, bootstrapStatistic+jackknife, permutationTest, SampleTestPanel/StatWorkspace/SimulateTab UI, Node validation harness + R cross-check). All landed; harness 81/81 green. Deferred: §4.1 R/Py/Stata snippet generators |
| 2026-06-07 | `specs/2026-06-07-design-language-refresh-design.md` | DONE (Franco signed off 2026-06-10) | UI upgrade Workstream A. T1–T9 complete + density T.*.fontSize tokens propagated to all 25 remaining files (Codex c339947 2026-06-09); T9 root `DESIGN.md` authored (commit 06c6dbd 2026-06-09). T10 final visual pass = Franco's subjective sign-off, complete. |
| 2026-06-07 | `plans/2026-06-07-design-language-refresh.md` | DONE | T1–T10 complete: density token migration + root DESIGN.md (06c6dbd) + final visual pass signed off 2026-06-10. |
| 2026-06-10 | `plans/2026-06-10-phase9-cross-dataset-pipeline.md` | DONE — browser-validation PENDING (Franco); Task 3b deferred | Phase 9.3/9.4/9.5 finish-and-wire. **Audit 2026-06-10: ~80% already built** (globalPipeline state + G-step registration + cascade UI + `generateWorkspaceScript` topo-sort exporter all exist). 3 real gaps: (A) `generateWorkspaceScript` unwired to any button; (B) `globalPipeline` not persisted (ephemeral `sessionState`, lost on reload); (C) derived-dataset model — **DECIDED keep-in-place** (Franco 2026-06-10); replication double-join risk resolved via `gStepId` filter. **Tasks 1–3 DONE 2026-06-10** (browser-validation pending): T1 workspace export wired in DatasetManager + double-join fix; T2 `globalPipeline` persisted to IDB (`sessionMeta_<pid>`); T3 fixed a cascade **data-loss bug** (was deleting the source left dataset on join removal) + in-place AS-BUILT spec note. **Remaining:** Task 4 (e2e browser verify) + Task 3b (G-step↔local-step desync — consistency/export-fidelity, not data-loss; recommend derive-globalPipeline-from-local). Codex-resumable. |
| 2026-06-02 | `specs/2026-06-02-qte-stat-sim-design.md` | DONE | Unconditional QTE in Stat & Simulation: `src/math/QTE.js` (`quantileTreatmentEffect`, type-7 quantiles via exported `Resampling.quantile`, seeded within-group bootstrap percentile/basic/BCa band) + `QTEPanel.jsx` (table + QTE-vs-τ SVG with dashed ATE line + overlaid-CDF SVG with QTE arrow) mounted in StatWorkspace + SimulateTab (simulated data). Validated: `inferenceValidation.js` qte suite 30 checks green (point QTE = R quantile(type=7) diff to 6dp, ATE = lm slope); R block in `inferenceRValidation.R`. Covariate-adjusted QR deferred to Modeling. Franco: browser-validate on Vercel |
| 2026-06-02 | `specs/2026-06-02-dgp-builder-upgrade-design.md` | IN PROGRESS | DGP builder upgrade: Categorical/factor draw (A ✓), GroupID/CycleID panel-ID generators (B ✓), end-to-end string preservation (C ✓) — all landed via shared `src/math/dgpDraw.js` (imported by SimulateTab + exprEval.worker.js → parity by construction); R/Py/Stata script-export extended; structural harness `__validation__/dgpValidation.js` green (37 checks); build clean. Optional Phase D (dplyr Expression helpers) deferred. Franco: browser-validate categorical/panel sim |
| 2026-06-01 | Supabase live RLS / advisor audit (`THREAT_MODEL.md` §3.7) | DONE | B1–B4 remediated; 2 migrations applied; 10→1 advisor lints. Open: enable leaked-password protection, rotate `AGENT_SECRET`, `db pull` migrations into repo |
| 2026-06-05 | `specs/2026-06-05-clean-explore-parity-vector-join-design.md` | DONE | Batch 1 for Codex: join types (right/full/anti/semi), Combine tab (bind_cols/union/intersect/setdiff), distinct, group_transform, Vector Join (`vector_assign` 4 modes, seeded mulberry32). Authored by Claude, executed solo by Codex |
| 2026-06-05 | `specs/2026-06-05-session-aware-coach-design.md` | DONE (browser-validated 2026-06-05; sessionLog deferred) | Roadmap item 3: make Research Coach session-aware (thread `sessionSnapshot` into `researchCoach` — pipeline/pinned/subsets/inference/log) + app-aware (hybrid `appCapabilityMap.js`: curated tab shell + auto-derived steps from STEP_REGISTRY, cached system block). Plan `plans/2026-06-05-session-aware-coach.md` (8 tasks). Claude's parallel track — collision-free with Codex Batch 1 |
| 2026-06-05 | `specs/2026-06-05-excel-grid-editing-design.md` | DONE | Roadmap item 2: Excel-grid editing in Data Viewer. 5 new steps (add_column, add_row, set_where, replace, str_splice) + structured filter bar as WHERE predicate. Non-destructive (emits pipeline steps). DataViewer (App.jsx) + DataStudio studio methods + R/Python/Stata export translations. Plan `plans/2026-06-05-excel-grid-editing.md` (6 tasks). Claude track |
| 2026-06-05 | `specs/2026-06-05-ai-execute-clean-commands-design.md` | DONE (browser-validation pending) | Clean-module AI upgrade: NL → validated declarative pipeline steps (multi-column/multi-step), preview-then-confirm. Fixes geometry→lat/lon bug (single-column `ai_tr` can't emit 2 cols). Built: `appCapabilityMap.serializeAllowedSteps`, `stepValidator.validateAISteps` (+node harness 6/6), `NL_TO_PIPELINE_PROMPT`, `AIService.nlToPipeline`, `NLCommandBar.jsx` mounted in WranglingModule. Plan `plans/2026-06-05-ai-execute-clean-commands.md`. Franco: browser-validate geometry command |
| (Phase 13.2) | Supabase `projects`/`pipelines` RLS tables + pipeline sync (in this file) | **SUPERSEDED** by `specs/2026-06-05-cloud-sync-e2ee-design.md` (Phase 4a) | The original 13.2 design stored **plaintext** pipeline JSON server-side (`projects`/`pipelines` tables). Intentionally NOT built — plaintext pipeline steps on the server contradict the privacy-first stance that hardened after 13.2 was written. Phase 4a delivers the same goal (cross-device project + pipeline resume) with **E2EE**: `supabase/migrations/202606061039_synced_projects.sql` stores only salt/verifier/encrypted `manifest` + encrypted blobs in a private `synced-blobs` bucket (server cannot decrypt). RLS = own-rows. Building the plaintext tables now would be a privacy regression + duplicate. No longer orphaned. (Phase 4a migration apply + advisor still pending Franco — tracked in the 2026-06-05 cloud-sync row above.) |
| 2026-06-03 | Callaway-Sant'Anna (2021) staggered DiD (item C3 of `specs/2026-06-01-modeling-poisson-twfe-gaps-design.md`) | DONE | `src/math/CallawayEngine.js` (OR estimator + IF SEs + event-study aggregation); wired end-to-end in EstimatorSidebar / ModelConfiguration / ModelingTab / EstimationResult; validation harness `callawayValidation.js` + R script. Franco: browser-validate on mpdta or own staggered panel. |
| 2026-06-03 | `specs/2026-06-03-outcome-family-chip-twopass.md` | DONE | Part 1: estimator dropdown refactor (identification strategy × outcome family chip row) + IV-Poisson math engine. Part 2: two-pass extraction (Extract to dataset from result panel). |
| 2026-06-03 | `plans/2026-06-03-outcome-family-chip-twopass.md` | DONE | All 12 tasks landed. P1: MODELS→pure strategies + FAMILY_SUPPORT chip row (EstimatorSidebar), `resolveEstimator(model,family)` dispatch, family-aware ModelConfiguration, `runIVPoisson` (two-step exponential GMM, J-test, first-stage F) wired 2SLS+Poisson chip + structural/DGP-recovery harness (R exact-6dp cross-val PENDING Franco's R run). P2: `inject_column` step (runner+registry), `ExtractPanel` → `DataStudio.addInjectColumnStep`, R/Py/Stata translators. Final review: 1 Important fixed (ExtractPanel gates on full row count, not preview). Franco: browser-validate two-pass + IV-Poisson. |
| 2026-06-03 | `specs/2026-06-03-dynamic-data-interceptor-observatorio-design.md` | DONE (architecture pivoted) | Imunify360 bot-protection blocks any server-side/proxy pull, so artifact-B's `observatorio-proxy` edge fn was dropped. Shipped instead: in-browser session-pull importer. `observatorio.js` is a pure parser (no fetch) with a SCHEMAS registry auto-detected by column count — `femicidios` (10-col, name+fiscal PII stripped) + `marchas` (5-col, keeps `convocatoria` campaign tag, drops HTML link). PII-strip whitelist + `SPANISH_MONTHS` date parser (ISO/D-M-Y/long-form, 1872→present) + id-default-on/hash-opt-in dedup retained. `ObservatorioFetcher.jsx` modal (paste/upload + console snippet); general JSON loader in `DataStudio.jsx` routes Observatorio-shaped payloads through `parseRegistry` (PII-safe) and generic JSON otherwise. Discovery tool (`tools/data-discovery/`) reduced to `verify_import.mjs` dev harness (PII-stripped aggregates) + README. Both padróns browser-validated (femicidios 5318 rows; marchas loaded 2026-06-04). |
| 2026-06-03 | `plans/2026-06-03-dynamic-data-interceptor-observatorio.md` | DONE (architecture pivoted) | Original 6-phase plan superseded: no edge function / no headless interception (bot-protection + ethics). Delivered P2 pure-JS helpers (`node --test` 15/15 green) + P3 parseRegistry/schemas + synthetic fixtures (femicidios + marchas) + P5 `ObservatorioFetcher.jsx`/App.jsx/DataStudio JSON loader wiring + P6 browser validation. Live data pulled via a per-padrón F12 XHR/fetch interceptor that auto-downloads the JSON (user's authenticated session). Marchas is the priority covariate; other padróns judged redundant. Next: build the grid×date panel (`date_extract`→`group_summarize`→`balance_panel` zero-fill) → Poisson FE / Sun-Abraham. |
| 2026-06-04 | `specs/2026-06-04-remove-primary-dataset-design.md` | DONE | Eliminate the "primary/main dataset" concept (Approach A): DataStudio = single source of truth, App.jsx = thin container. All datasets equal/first-class/deletable (incl. first); full registry persisted in new IDB `dataset_registry` store (was sessionStorage → lost on browser close); `projects.activeDatasetId` restored on reopen. No migration. Fixes dataset-loss-on-reopen bug. Landed: IDB v8 + self-healing `openDB` (adopts existing version, reopens at version+1 to backfill missing stores); DataStudio hydrates full registry + rows on mount, persists registry + active id on change; any dataset deletable (frees rows via `deleteRawData`); empty-project state. Build green; Franco browser-validated. |
| 2026-06-04 | `plans/2026-06-04-remove-primary-dataset.md` | DONE | 6-task implementation plan for the spec above (persistence doc-comments, DataStudio surgery, App thin-container, DataTab from availableDatasets, DatasetManager UI, acceptance matrix). All landed. |

---

## Phase 1: Standardised Estimation Result (Foundation) — DONE

### New file: `src/math/EstimationResult.js` — DONE

Single `wrapResult(type, engineOutput, spec)` factory that normalises all 9 estimator outputs into one canonical `EstimationResult` shape:

```
EstimationResult {
  id, type, family, timestamp, label, color,

  // Core coefficients (EVERY estimator)
  varNames[], beta[], se[], testStats[], testStatLabel("t"|"z"), pVals[],

  // Fit (nullable per estimator)
  R2, adjR2, R2Within, R2Between, mcFaddenR2, logLik, AIC, BIC,
  n, df, Fstat, Fpval,

  // Treatment effects (nullable)
  att, attSE, attP, late, lateSE, lateP,

  // Arrays (always present)
  resid[], Yhat[],

  // Sub-results (nullable)
  firstStages[], marginalEffects, oddsRatios, rddPlotData,

  // Spec metadata (what the user configured)
  spec: { yVar, xVars, wVars, zVars, entityCol, timeCol, ... },

  // Binary model flags
  converged, iterations
}
```

Internal `wrapLinear`, `wrapFE`, `wrapFD`, `wrap2SLS`, `wrapDiD`, `wrapTWFE`, `wrapRDD`, `wrapBinary` map each engine's idiosyncratic fields to canonical positions. Also exports `getCoeffBlock(result)` for Stargazer/AI use.

Duplicate MODELS metadata (id, label, color) as a plain object here to avoid circular dependency with `EstimatorSidebar.jsx`.

### Changes to `src/components/ModelingTab.jsx` — DONE
All estimation branches call `wrapResult()`. `result` state is a single canonical `EstimationResult`. All 13 estimator branches verified in code (OLS, WLS, FE, FD, 2SLS, DiD, TWFE, RDD, FuzzyRDD, Logit/Probit, GMM, LIML, LSDV, EventStudy, PoissonFE, SyntheticControl). useCallback dep-array patched to include treatedUnit, synthTreatTime, treatTimeCol, kPre, kPost, lsdvTimeFE — fixing stale-closure crash for Synthetic Control, Event Study, and LSDV.

### Changes to `src/ReportingModule.jsx` — IN PROGRESS
`normaliseResult()` is a thin shim that spreads raw and fills in `modelLabel`, `yVar`, `xVars`, `tStats` aliases — not a pure pass-through but functionally equivalent. `buildStargazer()` multi-model path exists.

### Changes to `src/services/ai/AIService.js` — DONE
`interpretRegression()` accepts `metadataReport` and appends metadata context. `compareModels()` handles N-way (array) and legacy 2-way call signatures.

### Changes to `src/math/index.js` — DONE
`wrapResult` and `getCoeffBlock` are re-exported.

### Verification
All estimator branches use `wrapResult`. setXVars destructuring bug and stale-closure bug in estimate() useCallback both fixed.

---

## Phase 2: Advanced Context-Aware AI Coach — DONE

### New file: `src/core/validation/metadataExtractor.js` — DONE

`buildMetadataReport(headers, rows, info, panelReport?)` returns:

```
MetadataReport {
  temporal: { dateCol, periodicity, dateFormat, minDate, maxDate, span },
  panelQuality: { balance, tDistribution{min,max,mean,median}, gapRate, withinVar, betweenVar, withinShare },
  columns: ColMetadata[],   // per-column: kurtosis, normalityLabel, logFeasible, coeffOfVar, skewness, withinVar, betweenVar
  highCorrelations[]
}
```

Key computations:
- **Date periodicity**: scan non-numeric columns with `Date.parse()`, compute mode of diffs (1d=daily, 7=weekly, 28-31=monthly, 89-92=quarterly, 365=annual). Also detect numeric year columns (all integers 1900-2100).
- **Kurtosis**: `sum((x-mean)^4/std^4)/n - 3`. Label: |k|<1 normal, k>3 leptokurtic, k<-1 platykurtic.
- **Log feasibility**: `min > 0 && max/min > 10`
- **Within/between variance**: per-entity means, `withinVar = avg(var_within)`, `betweenVar = var(entity_means)`, standard ANOVA decomposition.

### New file: `src/core/validation/coachingTriggers.js` — DONE

`generateCoachingSignals(metadata, activeResult?)` returns `CoachingSignal[]`:

```
CoachingSignal { id, severity, category, title, detail, suggestion, question }
```

Rule examples:
| Condition | Signal |
|-----------|--------|
| Daily periodicity + panel + FE model | Suggest TWFE for day-of-week/seasonal effects |
| Column skewness > 2 + logFeasible + column in xVars | Suggest log transform |
| Panel withinShare < 0.15 + FE model | Warn low within-variance, FE may lack power |
| Residual kurtosis > 5 (post-estimation) | Suggest robust SEs |
| Y is positive + level-level form + logFeasible | Suggest log-Y for elasticity interpretation |

### Changes to `src/services/ai/Prompts/index.js` — DONE
`buildMetadataContext()` exists and is imported by AIService.js.

### Changes to `src/services/ai/AIService.js` — DONE
Both `researchCoach` and `interpretRegression` accept and append `metadataReport`.

### Changes to `src/components/modeling/ResearchCoach.jsx` — DONE (file exists, accepts metadataReport prop)

### Changes to `src/components/ModelingTab.jsx` — DONE
`metadataReport` useMemo and `signals` useMemo wired. ModelingTab imports and renders all Phase 2 components.

### Verification
Pending Franco browser-validation of coaching signals end-to-end.

---

## Phase 3: Multi-Model Comparison System — DONE (multi-model export PARTIAL)

### New file: `src/services/modelBuffer.js` — DONE
Module-level singleton exists with add/remove/getAll/get/clear/count.

### New file: `src/components/modeling/ModelBufferBar.jsx` — DONE
File exists and is rendered in ModelingTab.

### New file: `src/components/modeling/ModelComparison.jsx` — DONE
File exists and is rendered in ModelingTab when compare mode active.

### Changes to `src/components/ModelingTab.jsx` — DONE
`bufferVersion` state, `pinnedModels` useMemo, ModelBufferBar and ModelComparison renders all present.

### Changes to `src/services/ai/AIService.js` — DONE
`compareModels()` handles N-way array input with legacy 2-way compatibility.

### Changes to export scripts — DONE
- `src/services/export/rScript.js`: `generateMultiModelRScript()` exists — DONE
- `src/services/export/pythonScript.js`: `generateMultiModelPythonScript()` — DONE (wired in ModelComparison.jsx)
- `src/services/export/stataScript.js`: `generateMultiModelStataScript()` — DONE (wired in ModelComparison.jsx)

### Verification
Pending Franco browser-validation of full comparison flow.

---

## Phase 4: Integration (1 day) — IN PROGRESS

Thread `metadataReport` to all consumers. Display coaching signals in results panel. End-to-end test: load panel dataset → run OLS → pin → run FE → pin → compare → check AI coach signals → export multi-model LaTeX + R script.

All multi-model export scripts (R, Python, Stata) are implemented and wired into ModelComparison.jsx. Remaining: browser validation of full Phase 3 comparison flow.

---

## New Files Summary (6)

| File | Purpose | Status |
|------|---------|--------|
| `src/math/EstimationResult.js` | Canonical result wrapper (Phase 1 foundation) | DONE |
| `src/core/validation/metadataExtractor.js` | Deep metadata extraction engine | DONE |
| `src/core/validation/coachingTriggers.js` | Rule-based coaching signal generator | DONE |
| `src/services/modelBuffer.js` | Session-level model registry | DONE |
| `src/components/modeling/ModelBufferBar.jsx` | Pinned models strip UI | DONE |
| `src/components/modeling/ModelComparison.jsx` | Side-by-side comparison UI | DONE |

## Modified Files Summary (9)

| File | Changes | Status |
|------|---------|--------|
| `src/math/index.js` | Re-export wrapResult, getCoeffBlock | DONE |
| `src/components/ModelingTab.jsx` | estimate() rewiring, buffer integration, metadata threading, coaching signals display, stale-closure dep-array fix | DONE |
| `src/ReportingModule.jsx` | Simplified normaliseResult (thin shim, not pure pass-through), canonical shape reads | IN PROGRESS |
| `src/services/ai/AIService.js` | Metadata-enriched coach/narrative, N-model comparison | DONE |
| `src/services/ai/Prompts/index.js` | buildMetadataContext(), extended COMPARE_MODELS_PROMPT | DONE |
| `src/components/modeling/ResearchCoach.jsx` | metadataReport prop, coaching signal chips | DONE |
| `src/services/export/rScript.js` | generateMultiModelRScript — DONE | DONE |
| `src/services/export/pythonScript.js` | `generateMultiModelPythonScript` — implemented + wired | DONE |
| `src/services/export/stataScript.js` | `generateMultiModelStataScript` — implemented + wired | DONE |

## Key Design Decisions

1. **Module singleton for ModelBuffer** — survives component unmount across tab navigation; avoids Context provider at App.jsx level. Re-render via version counter.
2. **Metadata in user message, not system** — preserves SHARED_CONTEXT prompt caching. Metadata varies per dataset (~200 tokens), appended to user block.
3. **MODELS metadata duplicated in EstimationResult.js** — avoids circular dependency with EstimatorSidebar.jsx. Just `{ id, label, color }` per estimator (~15 lines).
4. **Metadata computed at ModelingTab level** — uses final cleaned rows (post-pipeline), not intermediate wrangling state.
5. **Non-destructive multi-model exports** — new `generateMultiModelScript` functions alongside existing single-model ones.

---

## Phase 5: New Estimators — DONE (all 5 estimators implemented; crash bugs fixed)

Five new estimators in implementation order. Each section specifies the target file, function signature, algorithm, output contract, and UI touch-points.

---

### 5.1 Fuzzy RDD — DONE

**Target file:** `src/math/CausalEngine.js` (extends existing file)

**Signature:**
```js
runFuzzyRDD(rows, yCol, treatCol, runningCol, cutoff, { bandwidth, kernel, controls })
```

**Algorithm:**
Two-stage least squares where the sharp cutoff indicator `Z = 1(X >= c)` is the instrument and `D` (actual treatment receipt) is the endogenous variable. LATE is estimated as the ratio of the Y-discontinuity to the P(D=1)-discontinuity at the cutoff. Uses the existing `runWLS` kernel-weighting infrastructure for both stages.

- Stage 1: regress `D` on `Z`, controls, within bandwidth — produces `firstStageDisc` and `complianceRate`
- Stage 2: regress `Y` on `D_hat`, controls, within bandwidth — produces the fuzzy LATE
- SE via delta method propagating both stage variances
- Reuses `ikBandwidth`, kernel weight helpers already in `CausalEngine.js`

**New output fields:**
```
complianceRate     — P(D=1|X>=c) - P(D=1|X<c)
firstStageDisc     — first-stage discontinuity coefficient
LATE               — local average treatment effect
lateSE             — SE of LATE
```

**UI changes:**
- `ModelConfiguration.jsx` — add treatment-receipt variable selector (separate from running variable)
- `ModelPlots.jsx` — add compliance plot (P(D=1) vs running variable with cutoff line) and fuzzy scatter (Y vs X, colored by treatment receipt)

---

### 5.2 Event Study — DONE (stale-closure crash fixed)

**Target file:** `src/math/PanelEngine.js` (extends existing file)

**Signature:**
```js
runEventStudy(rows, yCol, xCols, unitCol, timeCol, treatVar, treatTimeCol, { kPre, kPost })
```

**Algorithm:**
TWFE regression with relative-time dummies `D_it^k = 1(t - treat_time_i = k)` for `k` in `[-kPre, kPost]`, omitting `k = -1` as the reference period. Coefficient vector maps one-to-one to event-time periods. Pre-trend F-test: joint significance of all lead coefficients (`k < -1`).

- Build relative-time column per unit from `treatTimeCol`
- Construct dummy matrix, drop `k = -1`
- Run within (FE) regression via existing `runFE` demeaning
- Extract `eventCoeffs` with 95% CI per period
- Compute `preTrendF` and `preTrendP` via Wald test on lead sub-vector

**New output fields:**
```
eventCoeffs[]   — [{ k, coeff, se, ciLow, ciHigh }]
preTrendF       — F-statistic on pre-period leads
preTrendP       — p-value for pre-trend test
```

**UI changes:**
- `EstimatorSidebar.jsx` — expose Event Study as a named estimator option
- `ModelConfiguration.jsx` — add `treatTimeCol` selector and `kPre`/`kPost` numeric inputs
- `ModelPlots.jsx` — `EventStudyPlot` component already exists; wire it to the formal `runEventStudy` output (currently only a stub/plot shell)

---

### 5.3 Panel LSDV — DONE (stale-closure crash fixed)

**Target file:** `src/math/PanelEngine.js` (extends existing file)

**Signature:**
```js
runLSDV(rows, yCol, xCols, unitCol, timeCol, { timeFE })
```

**Algorithm:**
OLS on the augmented design matrix that includes entity dummy columns (and optionally time dummy columns). Mathematically equivalent to the within estimator but explicitly recovers entity fixed effects `alpha_i` and, when `timeFE: true`, time fixed effects `lambda_t`. Uses the existing OLS path in `LinearEngine.js` after constructing the dummy matrix.

- Construct entity dummy matrix (drop one for identification)
- Optionally append time dummy matrix
- Call `runOLS` on the full design matrix
- Partition coefficient vector: `beta` (structural), `alphas` (entity dummies), `lambdas` (time dummies)

**New output fields:**
```
alphas    — { [unit]: coeff }   entity fixed effects
lambdas   — { [time]: coeff }   time fixed effects (null if timeFE: false)
```

**UI changes:**
- `ModelPlots.jsx` — heatmap of entity-by-time fixed effects (entity on y-axis, time on x-axis, alpha_i + lambda_t fill color)

---

### 5.4 Poisson FE (PPML) — DONE + browser-validated 2026-06-03

**Target file:** `src/math/NonLinearEngine.js` (extends existing file)

**Signature:**
```js
runPoissonFE(rows, yCol, xCols, unitCol, timeCol?)
```

**Algorithm:**
Poisson pseudo-maximum likelihood (PPML) with entity fixed effects via iterative demeaning (Guimaraes-Portugal 2010). Avoids inverting the full entity-dummy design matrix, which is infeasible for large `N`.

- Initialize `mu_it = Y_it` or uniform starting values
- IRLS outer loop (same skeleton as `runLogit`/`runProbit`): working weights `W = diag(mu)`, working response `z = eta + (Y - mu)/mu`
- Inner demeaning step per IRLS iteration: subtract entity means from `z` and `X` (within transform on working variables)
- Convergence: `||beta_new - beta_old||_inf < 1e-8` or 200 iterations
- Overdispersion check: Pearson chi-squared / df — flag if > 1.5

**New output fields:**
```
IRR[]          — exp(beta) per covariate, incidence rate ratios
pseudoR2       — 1 - logLik_full / logLik_null
overdispersion — Pearson chi-sq / df
entityAlphas   — { [unit]: alpha_i } (recovered post-convergence)
```

**UI changes:**
- `EstimatorSidebar.jsx` — add Poisson FE as estimator option (family: Panel)
- `ModelPlots.jsx` — predicted vs actual count scatter, Pearson residual histogram

---

### 5.5 Synthetic Control — DONE (setXVars destructuring bug and stale-closure crash fixed)

**Target file:** `src/math/SyntheticControlEngine.js` (new file)

**Signature:**
```js
runSyntheticControl(rows, yCol, unitCol, timeCol, treatUnit, preperiods, predictors[])
```

**Algorithm:**
Convex optimization: find donor weights `W` (W >= 0, sum(W) = 1) minimizing `||X1 - X0'W||^2_V` where `X1` is the treated unit's pre-period predictor vector, `X0` is the donor matrix, and `V` is a diagonal predictor-importance matrix (initialized as identity; optionally learned by outer loop minimizing pre-period MSPE).

Implemented via Frank-Wolfe projected gradient descent in pure JS — no external solver dependency:
1. Initialize `W = 1/n_donors` (uniform)
2. Gradient step: `g = -2 * X0 * V * (X1 - X0'W)`
3. Frank-Wolfe update: move weight toward donor `argmin g'e_j`
4. Project onto simplex: clip negatives, renormalize
5. Repeat until `||delta W||_inf < 1e-9` or 2000 iterations

Synthetic outcome series: `Y_synthetic[t] = W' * Y_donors[t]` for all `t`. Gap series: `gap[t] = Y_treat[t] - Y_synthetic[t]`. In-space placebo: jackknife leave-one-out — repeat optimization treating each donor as the "treated" unit, collect gap distributions for inference.

**New output fields:**
```
weights[]         — [{ unit, weight }] sorted descending, donors with w > 0.01
syntheticSeries[] — [{ time, synthetic }]
gapSeries[]       — [{ time, gap }]
preMSPE           — mean squared prediction error in pre-period
postMSPE          — mean squared prediction error in post-period (placebo benchmark)
placebos[]        — jackknife gap series per donor unit
```

**UI changes:**
- `EstimatorSidebar.jsx` — add Synthetic Control as estimator (family: Causal)
- `ModelConfiguration.jsx` — treated unit selector (dropdown of unique unit values), pre-period boundary input, predictor variable multi-select
- `ModelPlots.jsx` — three new plot components:
  - `SyntheticGapPlot` — gap series with zero line and pre/post shading
  - `SyntheticDonorWeights` — horizontal bar chart of donor weights
  - `SyntheticPlaceboPlot` — donor placebo gaps overlaid as grey lines, treated gap as colored foreground

### PENDING — SC weight discrepancy vs R Synth
Frank-Wolfe on normalized rows still produces different weights than R's Synth package.
Root cause: R's Synth uses a **two-level nested optimization** — outer Nelder-Mead/BFGS finds predictor importance weights V, inner ipop (quadratic program) finds donor weights W given V. Frank-Wolfe is a single-level optimizer that can't replicate this exactly.
Fix requires implementing the proper ADH two-level optimization:
1. Outer: optimize V via Nelder-Mead minimizing pre-period outcome MSPE
2. Inner: given V, solve quadratic program for W (requires implementing ipop-style QP in pure JS — `kernlab::ipop` equivalent)
Alternative: integrate a small WASM QP solver (e.g. `qpsolvers` via WASM) to replace Frank-Wolfe.
Validated R output for comparison: Region_28=0.281, Region_29=0.444 (top donors); pre-RMSPE=1.392; ATT=5.408.

---

## Phase 5 New Files Summary (1)

| File | Purpose | Status |
|------|---------|--------|
| `src/math/SyntheticControlEngine.js` | Frank-Wolfe convex optimization for synthetic control weights and gap series | DONE |

## Phase 5 Modified Files Summary (6)

| File | Changes | Status |
|------|---------|--------|
| `src/math/CausalEngine.js` | Add `runFuzzyRDD` | DONE |
| `src/math/PanelEngine.js` | Add `runEventStudy`, `runLSDV` | DONE |
| `src/math/NonLinearEngine.js` | Add `runPoissonFE` | DONE |
| `src/math/index.js` | Re-export all 5 new functions + `SyntheticControlEngine` | DONE |
| `src/components/modeling/ModelConfiguration.jsx` | Fuzzy RDD treatment selector, Event Study time selectors, Synthetic Control config | DONE |
| `src/components/modeling/ModelPlots.jsx` | Compliance plot, donor weights bar, gap plot, placebo overlay, Poisson diagnostics, LSDV heatmap | DONE |

---

## Phase 6: Robust Standard Errors — DONE

Add a `src/core/inference/robustSE.js` pure-JS module exporting:

- `hcSE(X, e, n, k, variant)` — HC0/HC1/HC2/HC3 sandwich estimator. HC1 is the default (matches R `vcovHC`). Formula: `V = (X'X)^{-1} B (X'X)^{-1}` where `B = Σ h_i² x_i x_i'` and h_i is the leverage-adjusted residual per variant.
- `clusteredSE(X, e, clusters, n, k)` — one-way clustered SE. Groups residuals by cluster variable, computes `B = Σ_g X_g' e_g e_g' X_g`, applies small-sample correction `G/(G-1) * (n-1)/(n-k)`.
- `twowayClusteredSE(X, e, clusters1, clusters2, n, k)` — Cameron-Gelbach-Miller two-way clustering (entity + time). `V = V_1 + V_2 - V_12`.
- `neweyWestSE(X, e, t_index, maxLag, n, k)` — HAC Newey-West with Bartlett kernel. For panel/time-series with autocorrelation.

Wire into ALL engines: LinearEngine, PanelEngine, CausalEngine, NonLinearEngine, GMMEngine. Each engine receives an optional `seType` argument: `"classical" | "HC1" | "HC2" | "HC3" | "clustered" | "twoway" | "HAC"` plus `clusterVar` and `timeVar`. Default remains classical for backward compatibility.

UI changes:
- Add SE type selector to `ModelConfiguration.jsx` — radio group: Classical / HC1 (Robust) / HC3 / Clustered / Two-Way / HAC (Newey-West)
- Cluster variable selector appears conditionally when Clustered or Two-Way selected
- Max lag input appears for HAC
- Display chosen SE type in CoeffTable header and in replication scripts

Validation: compare HC1 and clustered SE against R `sandwich::vcovHC` and `lmtest::coeftest` to 4 decimal places.

### Phase 6 New Files Summary (1)

| File | Purpose | Status |
|------|---------|--------|
| `src/core/inference/robustSE.js` | HC0-HC3 sandwich, one-way clustered, two-way (CGM), Newey-West HAC | DONE |

### Phase 6 Modified Files Summary (6)

| File | Changes | Status |
|------|---------|--------|
| `src/math/LinearEngine.js` | Accept `seType`, delegate to `robustSE.js` | DONE |
| `src/math/PanelEngine.js` | Same SE wiring | DONE |
| `src/math/CausalEngine.js` | Same SE wiring | DONE |
| `src/math/NonLinearEngine.js` | Same SE wiring | DONE |
| `src/math/GMMEngine.js` | Same SE wiring | DONE |
| `src/components/modeling/ModelConfiguration.jsx` | SE type radio group via InferenceOptions.jsx (rendered in ModelingTab) | DONE — wired through InferenceOptions.jsx |

---

## Phase 7: New File Format Support — DONE

### .rds (R Data Files) — DONE
`src/services/data/parsers/rds.js` exists. Custom XDR binary parser (no npm dependency). Wired in `src/DataStudio.jsx` via dynamic import.

### .shp (Shapefiles) — DONE
`src/services/data/parsers/shapefile.js` exists. Reads DBF attribute table as data frame, geometry as WKT. Wired in `src/DataStudio.jsx`. Note shown for .shp-only uploads directing user to upload .dbf. File accept list includes `.rds,.dbf`.

### Phase 7 New Files Summary (2)

| File | Purpose | Status |
|------|---------|--------|
| `src/services/data/parsers/rds.js` | R data file parser (data.frame, tibble, named list) | DONE |
| `src/services/data/parsers/shapefile.js` | Shapefile attribute table parser, geometry as WKT | DONE |

### Phase 7 Modified Files Summary (1)

| File | Changes | Status |
|------|---------|--------|
| `src/DataStudio.jsx` | Registers rds.js and shapefile.js in file upload handler; shows geometry note | DONE |

---

## Phase 8: Modeling UI Overhaul — DONE

Three independent improvements to `src/components/ModelingTab.jsx` and `src/components/modeling/`:

### 8.1 — "Choose Model" selector — DONE
`EstimatorSidebar.jsx` exists and is rendered. Grouped dropdown implemented.

### 8.2 — SE & Options Visual Panel — DONE
`src/components/modeling/InferenceOptions.jsx` exists with full SE type chips, cluster var selector, cluster2 var selector (two-way), HAC max lag input. All props flow into `estimate()` via ModelingTab.

### 8.3 — Inline Code Editor — DONE
`src/components/modeling/CodeEditor.jsx` exists. Three tabs (R/Python/Stata), textarea-based, pre-populated from active result. Rendered in ModelingTab with `<CodeEditor result={result} />`.

### Phase 8 New Files Summary (2)

| File | Purpose | Status |
|------|---------|--------|
| `src/components/modeling/InferenceOptions.jsx` | Collapsible SE type / cluster / FE type / HAC lag options panel | DONE |
| `src/components/modeling/CodeEditor.jsx` | Inline R/Python/Stata replication script viewer with textarea editing | DONE |

### Phase 8 Modified Files Summary (2)

| File | Changes | Status |
|------|---------|--------|
| `src/components/modeling/EstimatorSidebar.jsx` | Grouped "Choose Model" dropdown/popover | DONE |
| `src/components/ModelingTab.jsx` | InferenceOptions props wired into estimate(); CodeEditor rendered | DONE |

---

## Phase 9: Workspace Architecture — PENDING

Complete redesign of the application shell from a linear wizard to a spatial research workspace. Every section lives under the same project and session. All datasets are shared globally.

---

### 9.1 — Shell Restructure — PENDING

Replace the current top-level navigation with a persistent 7-tab workspace bar:

```
[ Data ]  [ Clean ]  [ Explore ]  [ Model ]  [ Simulate ]  [ Calculate ]  [ Report ]
```

**`App.jsx` / `DataStudio.jsx` changes:**
- Render the 7-tab bar at the top of every project view (below the project title bar)
- Each tab mounts its own module component; all share the same `sessionState` context
- `sessionState` holds: `datasets{}` registry, `globalPipeline[]`, `calcWorkspace{}`, `pinnedModels[]`
- The current `WranglingModule` becomes `[ Clean ]`, `ExplorerModule` becomes `[ Explore ]`, `ModelingTab` becomes `[ Model ]`, `ReportingModule` becomes `[ Report ]`

**Tab routing:** shallow hash-based (`#data`, `#clean`, `#explore`, `#model`, `#simulate`, `#calculate`, `#report`) — no full re-mount on tab switch, state preserved

---

### 9.2 — Session Dataset Manager — PENDING

A scrollable dataset registry panel, persistent across all tabs (rendered in every tab's left sidebar or as a collapsible panel).

**Dataset entry:**
```
● df_main        1842 × 12    [source: loaded]
● df_regions      412 × 4     [source: loaded]
◎ df_merged      1842 × 14    [source: G1 — left_join]
◎ df_final       1601 × 14    [source: G2 — intersect]
```

- `●` = source dataset (loaded from file, simulated, or created in Calculate)
- `◎` = derived dataset (output of a global pipeline step)
- Click to set as active dataset in the current tab
- Rename / delete actions per entry (delete warns on derived datasets — see 9.4)
- Scrollable when > 5 datasets

**World Bank and OECD fetchers** move here from their current locations. `[ Data ]` tab is the canonical place to load external data.

**Global interaction log** — collapsible at the bottom of the manager:
```
▾ Interactions
G1  left_join(df_main, df_regions) → df_merged   [key: region_id]
G2  intersect(df_merged, df_controls) → df_final
```
- Clicking a G-step shows its parameters inline (join type, key columns, selected columns)
- Add / delete G-steps from here

---

### 9.3 — Two-Tier Pipeline Architecture — PENDING

**Tier 1 — Local pipelines (per-dataset):**
- Each dataset in the registry carries its own `localPipeline[]` — the existing `runner.js` step array
- Steps operate on one dataset in isolation
- Shown in `[ Clean ]` tab when that dataset is active
- Numbered locally: 1, 2, 3…
- Implicit rule: **local steps always describe the dataset before it enters any global step**

**Tier 2 — Global pipeline (cross-dataset):**
- Session-level `globalPipeline[]` of cross-dataset operations
- Step types: `left_join`, `right_join`, `inner_join`, `append`, `intersect`, `union`, `setdiff`
- Each step has: `{ id, type, leftDatasetId, rightDatasetId, outputDatasetId, params }`
- Managed from the Dataset Manager interaction log (9.2), not from Clean tab
- G-steps numbered globally for export ordering

**Execution order rule:**
1. All local pipeline steps on source datasets run first
2. Then the global step runs (producing a derived dataset)
3. Then local pipeline steps on the derived dataset run (post-merge transformations)

This order is deterministic and matches how `runner.js` already replays steps.

> **AS-BUILT — in-place model (2026-06-10, supersedes the derived-dataset language in 9.2–9.5).**
> A join/append does **not** create a new `◎` derived dataset node; it augments the
> **left** dataset in place (`outputDatasetId === leftDatasetId`). Franco's Gap-C decision.
> - **State:** every local step carries `datasetId`; join/append also register a G-step in
>   the session `globalPipeline` (`WranglingModule.addStep`), now persisted to IndexedDB
>   (`sessionMeta_<pid>`) so lineage survives reload.
> - **Deletion (9.4):** no dataset is ever removed by a cascade (it would delete a source
>   dataset). Deleting a G-step removes only that interaction; deleting a source dataset
>   removes every G-step that references it. The "save snapshot / derived datasets removed"
>   flow does not apply.
> - **Export (9.5):** `generateWorkspaceScript` (`pipeline/exporter.js`) emits each dataset's
>   non-`gStepId` local steps in topo order, then the cross-dataset joins from `globalPipeline`
>   against the cleaned right df. Single-dataset/Clean export emits joins inline (raw right
>   load). The `gStepId` filter prevents double-emission.
> - **KNOWN LIMITATION (Task 3b):** the G-step record and the left dataset's local join step
>   are two records for one op, linked by `gStepId`; deleting one does not yet delete the
>   other, so they can desync (a deleted G-step still runs locally; a deleted local step
>   orphans its G-step). Fix: keep them in sync, or derive `globalPipeline` from local
>   pipelines. Tracked in `plans/2026-06-10-phase9-cross-dataset-pipeline.md`.

---

### 9.4 — Step Deletion Behavior — PENDING

**Local pipeline step deletion:**
- Optimistic delete: remove the step and replay the pipeline from `rawData`
- If downstream steps fail (reference a column that no longer exists), show which steps broke
- Present two options: *Delete broken steps* or *Undo deletion*
- No blocking warning before the delete attempt — failure feedback is sufficient

**Global pipeline step deletion:**
- Blocking warn before delete, showing full cascade:
  - Derived datasets that will be removed
  - Downstream G-steps that depend on those datasets
  - Pinned models that used any of the removed datasets
- Two options in the warning dialog:
  - **Save snapshot first** — materializes the derived dataset's current state as a new standalone source dataset (no G-step dependency), then proceeds with the delete
  - **Delete cascade** — removes the G-step, all downstream G-steps, and orphaned derived datasets

---

### 9.5 — Pipeline Export Architecture — PENDING

**Problem:** the current export scripts emit steps as a flat sequence. With a two-tier pipeline and multiple datasets, the exporter must understand dependency order.

**Solution:** each step in `runner.js` gains a `datasetId` field (which dataset it operates on). The exporter builds a **dependency graph** and does a topological traversal:

```
For each G-step in global pipeline order:
  1. Recursively emit local pipeline of left dataset (and its own G-step dependencies)
  2. Recursively emit local pipeline of right dataset (and its dependencies)
  3. Emit the join/intersect/append as a named assignment
After all G-steps:
  4. Emit any local pipeline steps on derived datasets
```

**Per-step export methods:** each step type in the registry gets `toR()`, `toStata()`, `toPython()` methods. The exporter calls the appropriate method per step, tracking the current dataset name in scope.

**Language-specific rules:**
- **R / dplyr:** steps on the same dataset chain with `|>`. A join is an inline `left_join()`. The right-hand dataset is pre-assigned if it has its own local pipeline; otherwise inlined as `right_df |> select(...)`.
- **Python / pandas:** same chaining logic with `.merge()`. Multi-step chains use intermediate assignments for readability.
- **Stata:** every intermediate dataset must be pre-materialized as a named `.dta` file. No inline sub-queries. The exporter emits `preserve/restore` or `use/save/merge` blocks sequentially. The right-hand dataset in any merge is always a separate `use ... using "file.dta"` block.

---

### 9.6 — Per-Tab Section Exports — DONE

Every tab gets a consistent export bar (top-right of the tab content area) with three buttons: **R**, **Stata**, **Python**. Each exports only the content of that tab as a standalone, runnable script.

| Tab | What the script contains |
|-----|--------------------------|
| Data | Dataset loading code (file paths, read_dta / read.csv calls) |
| Clean | Full local pipeline for the active dataset (all step types via toR/toStata/toPython) |
| Explore | Summary stats code + plot code for all plots built in the session |
| Model | Estimation code for all models run (existing CodeEditor logic, promoted) |
| Simulate | DGP definition code (set.seed, distributions, variable construction) |
| Calculate | Variable definitions and computed expressions |
| Report | Full bundle export (existing) |

These are **deterministic exports** — no AI involved. Fast, always available, free tier.

---

### 9.7 — Calculate Tab — PENDING

A structured **variable workspace** — not a REPL, but a form-based table of named scalar/vector values.

**Variable table:**
```
Name              Type        Value
────────────────────────────────────────────────
n                 Integer     1000
discount_rate     Float       0.06
city              String      "Munich"
start_date        Date        2020-01-01
treated           Boolean     TRUE
coeffs            Vector      1.2, 0.8, -0.3
```

**Add variable form:**
- Name field (validates: alphanumeric + underscore, no spaces)
- Type dropdown: Integer / Float / String / Date / Boolean / Vector
- Value input adapts to type: number input / text / date picker / toggle / comma-separated

**Computed rows** (separate section, labeled "Computed from dataset"):
```
mean_wage         Computed    mean(wage)    [from: df_main]
n_treated         Computed    sum(treated)  [from: df_main]
```
- Expression references active dataset columns
- Evaluated against current dataset state

**`as.data.frame` creator:**
- "New dataset from variables" button
- User selects which vector-type variables become columns, sets `n` (row count)
- Names the dataset and saves it to the Dataset Manager as a source dataset (`●`)

**Export (R):**
```r
n <- 1000L
discount_rate <- 0.06
city <- "Munich"
start_date <- as.Date("2020-01-01")
treated <- TRUE
coeffs <- c(1.2, 0.8, -0.3)
mean_wage <- mean(df$wage)
```

**Export (Stata):**
```stata
scalar n = 1000
scalar discount_rate = 0.06
local city "Munich"
scalar treated = 1
matrix coeffs = (1.2, 0.8, -0.3)
summarize wage, meanonly
scalar mean_wage = r(mean)
```

Workspace saved per project in IndexedDB alongside the pipeline.

---

### 9.8 — Simulate Tab — PENDING

A **DGP (Data Generating Process) builder** for generating synthetic datasets in the browser.

**Interface:**
- `n` input (number of observations)
- `seed` input (for reproducibility)
- Variable builder table — each row defines one variable:
  ```
  Name     Distribution    Parameters           Role
  ─────────────────────────────────────────────────────
  X1       Normal          μ=0, σ=1             covariate
  X2       Uniform         min=0, max=10        covariate
  eps      Normal          μ=0, σ=0.5           error
  Y        Expression      2 + 1.5*X1 - 0.8*X2 + eps   outcome
  ```
- Distributions: Normal, Uniform, Bernoulli, Poisson, Exponential, t, Chi-squared
- Expression rows reference previously defined variables (ordered evaluation)
- "Generate" button → produces a real dataset → saves to Dataset Manager as a source dataset
- Re-generate re-runs with same seed (deterministic)

**Export** produces `set.seed()` + generation code in R/Python/Stata.

---

### 9.9 — Plot Exports and Style Presets — PENDING

All plots throughout the app (Explore, Model, Report) gain a consistent export button: `.jpg`, `.svg`, `.pdf`.

**Style presets** (selectable before export):
- Default (current dark theme)
- Journal (white background, serif axis labels, minimal gridlines — APA/AER style)
- Presentation (high contrast, larger fonts, bold lines)
- Minimal (no gridlines, no border, axis lines only)

Presets apply at export time — the in-app dark theme is unchanged.

**Implementation:** export functions render the plot into an offscreen canvas/SVG with the chosen style applied, then trigger a download. No external dependencies.

---

### 9.10 — AI Unified Script Export (Premium) — PENDING

Available only from `[ Report ]` tab. User selects one target language (R, Stata, or Python — not all three simultaneously).

**Input to AI:** deterministic section scripts from all tabs (Clean + Calculate + Explore + Model + Simulate), dataset dictionary, variable units, research question (from project metadata).

**Output:** one complete, documented, runnable script in the chosen language:
- Section headers (`# 1. Setup`, `# 2. Data Loading`, `# 3. Cleaning`, etc.)
- Inline comments explaining non-obvious transformations
- Steps reordered for logical flow (variable definitions before models, cleaning before estimation)
- Redundant intermediate assignments collapsed
- Plots excluded (replaced with a comment: `# See exported plots`)

**Model:** `claude-sonnet-4-6` (same as narratives — consistent cost tier). Single API call with all section scripts concatenated as user message. Cached `SHARED_CONTEXT` block applies.

**Premium gating:** the button is visible to all users but triggers an upgrade prompt for free-tier users.

---

### Phase 9 New Files Summary

| File | Purpose | Status |
|------|---------|--------|
| `src/components/workspace/DatasetManager.jsx` | Scrollable session dataset registry, interaction log | PENDING |
| `src/components/workspace/WorkspaceBar.jsx` | 7-tab top navigation bar | PENDING |
| `src/components/tabs/DataTab.jsx` | Data loading, external fetchers, dataset preview | PENDING |
| `src/components/tabs/SimulateTab.jsx` | DGP builder, synthetic dataset generator | PENDING |
| `src/components/tabs/CalculateTab.jsx` | Variable workspace, as.data.frame creator | PENDING |
| `src/services/session/sessionState.js` | Session-level dataset registry + global pipeline store | PENDING |
| `src/pipeline/exporter.js` | Topological DAG traversal, per-step toR/toStata/toPython | PENDING |

### Phase 9 Modified Files Summary

| File | Changes | Status |
|------|---------|--------|
| `src/App.jsx` | Mount WorkspaceBar, route 7 tabs, thread sessionState context | PENDING |
| `src/DataStudio.jsx` | Integrate DatasetManager, move file upload to DataTab | PENDING |
| `src/pipeline/runner.js` | Add `datasetId` to step schema; expose `localPipeline` per dataset | DONE — field tagged in addStep (WranglingModule), documented in runner.js header |
| `src/pipeline/registry.js` | Add `toR`, `toStata`, `toPython` method stubs per step type | PENDING |
| `src/WranglingModule.jsx` | Become `CleanTab` — read active dataset from sessionState | PENDING |
| `src/ExplorerModule.jsx` | Become `ExploreTab` — read active dataset from sessionState | PENDING |
| `src/components/ModelingTab.jsx` | Read active dataset from sessionState; add tab-level export bar | PENDING |
| `src/ReportingModule.jsx` | Add AI unified script export button (premium) | PENDING |

### Phase 9 Build Order

Steps must be done in this order — each unlocks the next:

1. **`sessionState.js`** — dataset registry + global pipeline; the shared state all tabs depend on
2. **`WorkspaceBar.jsx` + `App.jsx` routing** — shell exists, tabs render existing modules
3. **`DatasetManager.jsx`** — dataset picker visible everywhere; active dataset selection works
4. **`runner.js` `datasetId` field** — each step tagged to a dataset; no behavior change yet
5. **`DataTab.jsx`** — move file upload + World Bank / OECD fetchers here
6. **`CalculateTab.jsx`** — variable workspace + `as.data.frame` creator
7. **`SimulateTab.jsx`** — DGP builder
8. **`exporter.js`** — DAG traversal, per-step export methods, section script generation
9. **Per-tab export bars** — wire exporter into each tab's R/Stata/Python buttons
10. **Plot style presets + .jpg/.svg/.pdf export** — last because it's self-contained
11. **AI unified script export** — depends on exporter (step 8) being complete

---

---

## Phase 10: Probability & Simulation Analytics — PENDING

Extends the already-built Calculate and Simulate tabs with probability functions, Monte Carlo, and output visualization. All math stays in `src/math/calcEngine.js` (pure JS, no React).

### Already done (do not re-implement)
- `solveRoot` (Brent's method), `derivative`, `nthDerivative`, `gradient`, `predict` — all in `calcEngine.js`
- ForLoop and WhileLoop variable types in `SimulateTab.jsx`
- Model prediction section (section 6) in `CalculateTab.jsx`

---

### 10.1 — Probability density and distribution functions in `calcEngine.js` — PENDING

Add to `calcEngine.js` (pure JS, no external dependency):

| Function | Signature | Algorithm |
|----------|-----------|-----------|
| `dnorm(x, mean, sd)` | PDF | `(1/σ√2π) exp(-½((x-μ)/σ)²)` |
| `pnorm(x, mean, sd)` | CDF | error function approximation (Abramowitz & Stegun 7.1.26) |
| `qnorm(p, mean, sd)` | quantile | rational approximation (Peter Acklam's algorithm) |
| `dt(x, df)` | t PDF | `Γ((ν+1)/2) / (√νπ Γ(ν/2)) (1 + x²/ν)^(-(ν+1)/2)` |
| `pt(x, df)` | t CDF | regularized incomplete beta: `I(ν/(ν+x²); ν/2, 1/2)` |
| `qt(p, df)` | t quantile | Newton refinement from rational seed |
| `dbinom(k, n, p)` | Binomial PMF | `C(n,k) pᵏ (1-p)^(n-k)` |
| `pbinom(k, n, p)` | Binomial CDF | sum over `j = 0..k` |
| `dpois(k, lambda)` | Poisson PMF | `λᵏ e^{-λ} / k!` |
| `ppois(k, lambda)` | Poisson CDF | sum over `j = 0..k` |
| `dchisq(x, df)` | Chi-sq PDF | gamma distribution special case |
| `pchisq(x, df)` | Chi-sq CDF | regularized incomplete gamma |

These functions become available as named functions inside **Calculate tab expression rows** (section 1 Expression type) and inside **Simulate tab Expression rows** — no new UI needed, just register them in `buildScope()` in `calcEngine.js`.

**Validation:** Compare to R outputs (`dnorm`, `pnorm`, `qnorm`, `pt`, `pbinom`, `ppois`) at 4 decimal places.

---

### 10.2 — Monte Carlo section in `SimulateTab.jsx` — PENDING

A new collapsible section below the DGP builder: **Monte Carlo Experiment**.

**Interface:**
```
Replications    [  1000  ]    Seed  [ 42 ]
Target variable  [ Y ▾ ]     (any scalar expression variable in the DGP)
[  Run Monte Carlo  ]
```

**Algorithm:**
1. Re-run the entire DGP `R` times, each time advancing the seed by +1
2. Collect the value of the target variable at each replication → array of length R
3. Output as a new dataset (rows = replications, columns = target variable + replication index)
4. Save to Dataset Manager via `onAddDataset`

**Output panel (shown after run):**
- Mean, SD, min, max, p5, p25, p50, p75, p95 of the collected distribution
- Inline histogram (50-bin) rendered via Observable Plot (same CDN pattern as PlotBuilder)

**Export:**
```r
set.seed(42)
mc_results <- replicate(1000, { ... dgp code ... })
hist(mc_results)
```

---

### 10.3 — Probability calculator panel in `CalculateTab.jsx` — PENDING

A new collapsible section: **Probability Calculator**. Form-based, no expression typing needed.

```
Distribution  [ Normal ▾ ]    μ = [  0  ]   σ = [  1  ]

P(X ≤ x)    x = [  1.96  ]   →   0.9750
P(X ≥ x)    x = [  1.96  ]   →   0.0250
P(a ≤ X ≤ b)  a = [  -1  ]  b = [  1  ]   →   0.6827
Quantile     p = [  0.95  ]  →   1.6449
```

Distributions available: Normal, t (df input), Binomial (n, p inputs), Poisson (λ input), Chi-squared (df input).

Updates live as inputs change (no "run" button). Calls the functions from 10.1.

---

### Phase 10 New Files Summary

| File | Purpose | Status |
|------|---------|--------|
| — | No new files — all additions extend existing files | — |

### Phase 10 Modified Files Summary

| File | Changes | Status |
|------|---------|--------|
| `src/math/calcEngine.js` | Add `dnorm`, `pnorm`, `qnorm`, `dt`, `pt`, `qt`, `dbinom`, `pbinom`, `dpois`, `ppois`, `dchisq`, `pchisq`; register in `buildScope()` | DONE |
| `src/components/tabs/SimulateTab.jsx` | Add Monte Carlo section (10.2) | DONE |
| `src/components/tabs/CalculateTab.jsx` | Add Probability Calculator section (10.3) | DONE |

---

## Phase 11: Spatial Analytics — PENDING

Browser-side spatial toolkit for research workflows common in development economics, urban economics, and policy evaluation: geocoding, distance-to-treatment, buffer indicators, grid assignment, and spatial joins.

All math in a new pure-JS engine `src/math/SpatialEngine.js`. Pipeline integration follows the existing runner.js pattern. UI lives in a new **Spatial** section of the wrangling FeatureTab.

---

### 11.1 — `src/math/SpatialEngine.js` — PENDING

Pure JS, no external dependencies. Exports:

**Distance functions:**
```js
haversine(lat1, lon1, lat2, lon2)  → distance in km
euclidean(x1, y1, x2, y2)         → distance in projected units
```
Haversine formula: `a = sin²(Δφ/2) + cos φ₁ cos φ₂ sin²(Δλ/2)`, `d = 2R arcsin(√a)`, R = 6371 km.

**Buffer:**
```js
isWithinBuffer(lat, lon, centerLat, centerLon, radiusKm)  → boolean
assignBuffer(rows, latCol, lonCol, centerLat, centerLon, radiusKm, outCol)  → rows[]
```
Uses haversine. Output column is 0/1 integer (ready for use as treatment indicator).

**Grid assignment:**
```js
assignRectGrid(rows, latCol, lonCol, cellSizeKm, outCol)  → rows[]
assignH3Grid(rows, latCol, lonCol, resolution, outCol)    → rows[]  // H3-like hex IDs
```
Rectangular: floor(lat / latStep) × floor(lon / lonStep) → integer cell ID. H3-like: approximate hexagonal grid using axial coordinates at given resolution.

**Spatial join (point-in-polygon):**
```js
pointInPolygon(lat, lon, polygonWKT)  → boolean
spatialJoin(pointRows, latCol, lonCol, polyRows, wktCol, joinCols[])  → rows[]
```
Ray-casting algorithm for WKT polygon strings (from `.shp` parser output). `spatialJoin` does a left join — each point row gets attribute columns from the first matching polygon.

**Nearest neighbor:**
```js
nearestNeighbor(rows, latCol, lonCol, referenceRows, refLatCol, refLonCol, outDistCol, outIdCol)  → rows[]
```
For each observation finds the closest point in a reference set and returns the distance and ID. Brute-force O(n×m) — acceptable up to ~10k × ~1k.

---

### 11.2 — Geocoding pipeline step — PENDING

New step type `geocode` in `runner.js` and `registry.js`.

**Step schema:**
```js
{ type: "geocode", addressCol: string, latOutCol: string, lonOutCol: string, provider: "nominatim" }
```

**Algorithm:**
- Calls OpenStreetMap Nominatim API (`https://nominatim.openstreetmap.org/search?q=...&format=json`)
- Rate-limited: 1 request per second (Nominatim ToS)
- Results cached in `sessionStorage` keyed by address string — avoids re-fetching on pipeline replay
- Skips rows where `addressCol` is empty or already geocoded (cache hit)
- Adds `latOutCol` and `lonOutCol` as new columns (null if geocoding failed)

**UI in FeatureTab (new "Spatial" subsection):**
```
Address column  [ country_name ▾ ]
Lat column name  [ lat ]
Lon column name  [ lon ]
Provider  [ OpenStreetMap (free) ]
[ Geocode column ]   — progress bar during batch geocoding
```

Warning shown: "Geocoding sends address data to OpenStreetMap. Do not use with sensitive or personal addresses."

---

### 11.3 — Distance, buffer, and grid pipeline steps — PENDING

Four new step types in `runner.js` / `registry.js`:

**`distance` step:**
```js
{ type: "distance", latCol, lonCol, refLat: number, refLon: number, outCol, unit: "km"|"m" }
```
Computes haversine distance from each row to a fixed reference point (e.g. capital city, policy center). UI: lat/lon inputs for reference point, or "pick from dataset" dropdown to use a filtered row as reference.

**`buffer` step:**
```js
{ type: "buffer", latCol, lonCol, refLat: number, refLon: number, radiusKm: number, outCol }
```
Outputs 0/1 column. UI: reference point + radius slider (1–500 km).

**`assign_grid` step:**
```js
{ type: "assign_grid", latCol, lonCol, gridType: "rectangular"|"hex", cellSizeKm: number, outCol }
```
Outputs a string grid cell ID. Suitable as a fixed effect variable. UI: grid type toggle + cell size input + preview count of distinct cells.

**`spatial_join` step:**
```js
{ type: "spatial_join", latCol, lonCol, rightDatasetId, wktCol, joinCols: string[] }
```
Joins polygon attributes from a shapefile dataset. Right dataset must have a WKT geometry column (from `.shp` parser). UI: polygon dataset dropdown, WKT column auto-detected, columns to join multi-select.

---

### 11.4 — Spatial UI in FeatureTab — PENDING

New collapsible "Spatial" section at the bottom of `FeatureTab.jsx`, below the existing "Interactions" section.

Contains five sub-panels (each collapsed by default):
1. **Geocode** — address column → lat/lon (wires step 11.2)
2. **Distance to point** — lat/lon + reference → distance column (wires `distance` step)
3. **Buffer indicator** — lat/lon + reference + radius → 0/1 column (wires `buffer` step)
4. **Grid assignment** — lat/lon + cell size → grid ID column (wires `assign_grid` step)
5. **Spatial join** — lat/lon + polygon dataset → attribute columns (wires `spatial_join` step)

Each sub-panel follows the existing FeatureTab pattern: form inputs → "Add to pipeline" button → step appears in History.jsx.

---

### 11.5 — Map view in PlotBuilder — PENDING

New geom type `map` in `PlotBuilder.jsx`.

When `map` geom is selected:
- X mapping locked to `lon`, Y mapping locked to `lat`
- Renders as a scatter plot with aspect ratio locked to `cos(mean_lat)` (Mercator approximation)
- Color, size aesthetic mappings still available
- Optional: basemap tiles toggle (uses OpenStreetMap tile CDN `https://tile.openstreetmap.org/{z}/{x}/{y}.png` — shown only if user enables it, with a privacy notice)

No new dependencies — Observable Plot handles the scatter rendering; tile layer is an optional `<img>` underlay positioned via CSS transform if enabled.

---

### Phase 11 New Files Summary

| File | Purpose | Status |
|------|---------|--------|
| `src/math/SpatialEngine.js` | Haversine, buffer, grid, point-in-polygon, nearest neighbor | DONE |

### Phase 11 Modified Files Summary

| File | Changes | Status |
|------|---------|--------|
| `src/pipeline/runner.js` | Add `geocode`, `distance`, `buffer`, `assign_grid`, `spatial_join` step types | DONE |
| `src/pipeline/registry.js` | Register 5 new step types with labels and param schemas | DONE |
| `src/components/wrangling/FeatureTab.jsx` | Add Spatial section with 5 sub-panels | DONE |
| `src/components/PlotBuilder.jsx` | Add `map` geom type with locked lat/lon axes and tile option | PENDING |

### Phase 11 Build Order

1. **`SpatialEngine.js`** — pure math, no UI, validates independently
2. **`runner.js` + `registry.js`** — wire 4 deterministic steps (distance, buffer, grid, spatial_join) — no network, testable offline
3. **`FeatureTab.jsx` Spatial section** — UI for all 4 deterministic steps
4. **Geocode step** — last because it requires network + rate limiting + cache logic
5. **PlotBuilder `map` geom** — self-contained, can ship independently of geocoding

---

## Phase 12: Excel-style Cell Editing — PENDING

Inline cell editing directly in the DataViewer grid. Edits are non-destructive: each committed change becomes a `patch` pipeline step (already implemented in `runner.js` and `registry.js`), so all downstream transforms (mutate, log, etc.) automatically reflect the new value.

### Infrastructure already in place (do not re-implement)
- `patch` step type in `runner.js` and `registry.js` — matches row by `__ri`, sets column value
- `__ri` stable row ID — assigned at load time in `DataStudio.ensureRowIds`, survives filter/sort/rename
- `addPatchStep(ri, col, value)` exposed via `DataStudio` `useImperativeHandle`
- `addStepRef` / `wranglingAddStepRef` bridge from DataStudio → WranglingModule
- History.jsx collapsible "Cell edits (N)" group with per-item remove and bulk "clear" button
- `clearPatches` in WranglingModule
- `✎ edit cells` toggle button in DataViewer toolbar (gates editing behind explicit activation)
- `isEditing` guard: `editingCell != null && row.__ri != null && editingCell.ri === row.__ri && editingCell.col === h`
- runner.js patch guard: `s.ri != null` — prevents stale `ri:undefined` step from nuking all rows
- DataStudio sync useEffect fix: `ensureRowIds` applied in both `newFile` and `else` branches

### What is NOT working (as of 2026-05-04)
Double-click to edit fails silently — the input either does not appear or does not receive focus. Root cause not yet identified despite multiple approaches:
- `autoFocus` on input
- `requestAnimationFrame` + `useRef` focus
- `onMouseDown` + `e.preventDefault()` (removed — suspected to suppress dblclick in some browsers)

### Recommended next approach
Use a **native DOM event listener** on the table container instead of React's `onDoubleClick` synthetic event, to rule out synthetic event system issues:

```js
const tbodyRef = useRef(null);
useEffect(() => {
  if (!editMode) return;
  const handler = e => {
    const td = e.target.closest('td[data-ri]');
    if (!td) return;
    const ri = Number(td.dataset.ri);
    const col = td.dataset.col;
    const val = td.dataset.val ?? "";
    startEdit(ri, col, val);
  };
  tbodyRef.current?.addEventListener('dblclick', handler);
  return () => tbodyRef.current?.removeEventListener('dblclick', handler);
}, [editMode]);
```

Each `<td>` gets `data-ri={row.__ri} data-col={h} data-val={row[h]}`. The `<tbody>` gets `ref={tbodyRef}`.

### Script export (also PENDING)
`src/services/export/rScript.js`, `pythonScript.js`, `stataScript.js` must emit `patch` steps as language-appropriate cell assignment statements before the main pipeline chain:
- R: `df[df$__ri == 47, "wage"] <- 1500`
- Python: `df.loc[df['__ri'] == 47, 'wage'] = 1500`
- Stata: `replace wage = 1500 if __ri == 47`

---

---

## Phase 13: Project Isolation & User Authentication — PARTIALLY DONE

Pre-condition for the web launch. Two distinct problems: (1) projects are not properly scoped — files loaded inside one project can leak into the project list as separate projects, and (2) there is no user identity, so the app is single-user only.

---

### 13.1 — Project Isolation Fix — DONE

**Current bug:** when a user loads multiple datasets inside a project, each file may create a top-level project entry rather than being scoped as a dataset within the current project. The project picker on the home screen shows file names instead of project names.

**Root cause area:** `DataStudio.jsx` — project creation on file upload; `App.jsx` — project list reading from IndexedDB.

**Fix:**
- Enforce that a **project** is created only when the user explicitly names and creates one (or on first load).
- All `onAddDataset` calls within an active project scope to `pid` — never create a new `pid`.
- The `App.jsx` project list reads `project.name` (user-set), not `dataset.filename`.
- If no project name is set, default to `"Untitled project — YYYY-MM-DD"`.
- IndexedDB schema: `projects` store keyed by `pid` with `{ pid, name, createdAt, updatedAt }`. Datasets and pipelines reference `pid`, never appear as project entries.

**Files modified:**
| File | Change | Status |
|------|--------|--------|
| `src/App.jsx` | Dashboard reads `listProjects()`; migration from pipelines; rename in-place; `handleReady` calls `saveProject` | DONE |
| `src/WranglingModule.jsx` | On pipeline save, also calls `saveProject` for primary pids (starts with "proj_") | DONE |
| `src/services/Persistence/indexedDB.js` | v3 — `projects` store; `saveProject`, `listProjects`, `deleteProject`, `clearAllProjects` | DONE |

---

### 13.2 — User Authentication — DEFERRED (web launch already live without auth)

**Backend choice: Supabase** — open-source, free tier covers the test launch, has auth + PostgreSQL + row-level security. No custom server needed to ship v0.1.

**Auth flows:**
- Email + password (primary)
- Magic link (secondary, lower friction for academic users)
- Google OAuth (optional — adds adoption for non-LMU users)

**Privacy-first constraint:** dataset content **never leaves the browser**. Only the following is stored server-side:
- `user_id`, email, `created_at`
- Project metadata: `{ pid, name, created_at, updated_at }`
- Pipeline steps (JSON, no raw data): `{ pid, pipeline[] }` — enables cross-device project resume without uploading data

**Implementation:**
- Install `@supabase/supabase-js` (CDN import to avoid bundle size — same pattern as Leaflet/Observable Plot)
- `src/services/auth/authService.js` — wraps Supabase auth: `signUp`, `signIn`, `signOut`, `getSession`, `onAuthStateChange`
- `src/services/auth/AuthContext.jsx` — React context: `{ user, session, loading }`, available app-wide
- `src/components/auth/AuthGate.jsx` — renders login/signup UI if no session; renders `<App>` if authenticated
- `src/components/auth/LoginForm.jsx` — email + password form with "send magic link" toggle; IBM Plex Mono, dark theme
- `src/components/auth/SignupForm.jsx` — name, email, password, institution (optional — useful for LMU targeting)

**Session persistence:** Supabase SDK handles token refresh automatically. `AuthContext` initializes on mount by calling `supabase.auth.getSession()`.

**Supabase tables (RLS enforced — users only see their own rows):**
```sql
projects (pid text PK, user_id uuid FK, name text, created_at timestamptz, updated_at timestamptz)
pipelines (pid text FK, steps jsonb, updated_at timestamptz)
```
Datasets are never stored in Supabase — they remain in the user's IndexedDB, keyed by `pid`.

> **SUPERSEDED (2026-06-10):** the plaintext `projects`/`pipelines` tables above were intentionally
> never built. Storing plaintext pipeline JSON server-side contradicts the privacy-first stance that
> hardened after this was written. Cross-device project + pipeline resume is delivered instead by the
> **E2EE** Phase 4a design (`specs/2026-06-05-cloud-sync-e2ee-design.md`,
> `supabase/migrations/202606061039_synced_projects.sql`) — server stores only an encrypted
> `manifest` + encrypted blobs it cannot decrypt. Auth itself (login UI, AuthGate) remains DEFERRED.

**New files:**
| File | Purpose |
|------|---------|
| `src/services/auth/authService.js` | Supabase auth wrapper |
| `src/services/auth/AuthContext.jsx` | React auth context provider |
| `src/components/auth/AuthGate.jsx` | Auth guard wrapping App |
| `src/components/auth/LoginForm.jsx` | Login UI |
| `src/components/auth/SignupForm.jsx` | Signup UI |

**Modified files:**
| File | Change |
|------|--------|
| `src/App.jsx` | Wrap with `<AuthGate>` |
| `src/DataStudio.jsx` | Attach `user_id` to projects; sync pipeline to Supabase on save |
| `src/services/Persistence/indexedDB.js` | Add project store; `listProjects` scoped to current user |

---

### 13.3 — Tier & Access Control — DONE

Three tiers for the initial launch:

| Tier | Price | Limits | Notes |
|------|-------|--------|-------|
| **Free** | €0 | 3 projects, no AI features, no export scripts | For onboarding and testing |
| **Researcher** | €19/mo | Unlimited projects, full AI, all exports | Individual academic users |
| **Institution** | €499/seat-yr | All Researcher features + team projects + priority support | LMU department licensing target |

Tier stored on Supabase in `users.tier` column. Checked client-side (gated in `AuthContext`) — not security-critical for v0.1 since the product is client-side anyway. Proper server-side enforcement comes in v0.2.

**Premium gates (v0.1):**
- AI narrative interpretation → Researcher+
- AI unified script export → Researcher+
- More than 3 projects → Researcher+

Gate implementation: thin `usePremium()` hook returning `{ canUse: bool, showUpgrade: fn }`. Upgrade prompt is a modal with "Email us" CTA for v0.1 (no Stripe yet).

---

### Phase 13 Build Order

1. **`indexedDB.js` project store** — adds `projects` object store without breaking existing data
2. **Project isolation fix** (`App.jsx` + `DataStudio.jsx`) — testable locally before auth
3. **Supabase project setup** — create project, configure RLS, get API keys
4. **`authService.js` + `AuthContext.jsx`** — auth logic, no UI yet
5. **`LoginForm.jsx` + `SignupForm.jsx`** — auth UI
6. **`AuthGate.jsx` + wire into `App.jsx`** — gate the whole app
7. **Pipeline sync to Supabase** — on save, write pipeline JSON to `pipelines` table
8. **Tier gates** — `usePremium()` hook, upgrade modal

---

## Phase 14: Web Launch (v0.1 Public Beta) — DONE

**Goal:** a hosted URL to share with test users (friends, thesis group, LMU contacts). Fast feedback loop. Not production — some rough edges expected.

---

### 14.1 — Frontend Deployment — DONE (Vercel live)

**Host: Vercel** (free tier, auto-deploy from main branch, CDN-edge delivery).

- `vite.config.js` already configured for React; just needs `vercel.json` with SPA fallback:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ANTHROPIC_KEY`
  - Anthropic key: user supplies their own for v0.1 (entered in app settings, stored in `sessionStorage` — never logged or sent to our backend)
  - For v0.2: proxy all Anthropic calls through a serverless function (removes key exposure)
- Custom domain: `app.litux.io` (or similar — TBD)

**New files:**
| File | Purpose |
|------|---------|
| `vercel.json` | SPA rewrite rule |
| `.env.example` | Document all required env vars |

---

### 14.2 — Anthropic Key Handling for Web — DONE

**v0.1 approach (fast):** user enters their own Anthropic API key in a Settings modal. Key stored in `sessionStorage` only — cleared on tab close.

**Settings modal** (`src/components/SettingsModal.jsx`):
- API key input (password type) + "Test connection" button
- Privacy notice: "Your key is stored only in this browser tab's session memory. It is never sent to our servers."
- Persistent across the session (re-enter on each browser session)

**`AIService.js` change:** read API key from `sessionStorage` instead of hardcoded env var, with a fallback to `import.meta.env.VITE_ANTHROPIC_KEY` for local development.

**v0.2 approach (proper):** serverless proxy on Vercel (`/api/claude`) — Anthropic key lives server-side, never exposed to browser. Users authenticate with their Econ Studio session token to call the proxy. This enables Researcher tier metering (track token usage per user).

---

### 14.3 — Landing Page & Marketing Site — DONE

**Separate from the app.** Hosted at `litux.io` (root domain). Built with the same Vite + React stack but as a standalone page — no app logic, no Supabase dependency.

**Sections:**
1. **Hero** — headline + subheadline + "Request early access" CTA (email capture)
   - Headline: *"Research-grade econometrics. No code required."*
   - Subheadline: *"The tool PhD students and policy analysts use to go from raw data to publication-ready results — entirely in the browser."*

2. **Feature highlights** — 3 cards:
   - *Estimation suite* — OLS, IV, RDD, DiD, FE, Synthetic Control with validated math
   - *Spatial analytics* — Maps, grid construction, buffer analysis, choropleth from shapefiles
   - *Replication export* — One-click R, Python, Stata scripts from every analysis

3. **Who it's for** — PhD students · Thesis students · Policy analysts · Research assistants

4. **How it works** — 3 steps: Load data → Build pipeline → Estimate + export

5. **Privacy first** — *"Your data never leaves your browser. All computation is client-side."*

6. **Early access form** — email + institution + use case (3 fields, submits to Supabase `waitlist` table or Airtable)

7. **Footer** — links, LMU affiliation note, contact email

**Design:**
- Same IBM Plex Mono + dark theme as the app (brand consistency)
- Accent: teal `#6ec8b4` for CTAs, gold `#c8a96e` for feature badges
- Background: near-black `#080808`
- No stock photos — code/plot screenshots from actual app only

**New files:**
| File | Purpose |
|------|---------|
| `landing/index.html` | Standalone landing page (separate Vite app or `public/index.html` at root domain) |
| `landing/App.jsx` | Landing page component |
| `landing/sections/` | Hero, Features, HowItWorks, Privacy, EarlyAccess, Footer components |

---

### 14.4 — Feedback Collection — DONE

Built into the app for v0.1 beta users. Lightweight — no external service needed.

- **"Send feedback" button** in the app header (top-right, always visible)
- Opens a small modal: text area + category dropdown (Bug / Feature request / Question / Other) + optional email field
- Submits to `feedback` table in Supabase
- No AI processing — just stored as raw text for Franco to review

**New file:** `src/components/FeedbackModal.jsx`

---

### Phase 14 Build Order

1. **`vercel.json` + env vars** — deploy the current app to Vercel (no auth yet — just confirms it builds)
2. **`SettingsModal.jsx` + APIkey sessionStorage** — unblocks AI for web users
3. **Landing page** — parallel work, independent of app code
4. **`FeedbackModal.jsx`** — quick win, high value for beta feedback
5. **Auth (Phase 13) integration** — add login gate once landing page is live
6. **Custom domain** — point `app.litux.io` at Vercel deployment

---

## Phase 15: Local Installable Version — PENDING

**Prerequisite:** web version is validated (Phase 14). The local version is the web app packaged as a desktop app with offline support.

**Goal:** users install once, get offline access, and the app auto-updates from the hosted version. No cloud sync required — all data stays local in IndexedDB.

---

### 15.1 — Tauri Packaging — PENDING

**Why Tauri over Electron:**
- ~10× smaller binary (no bundled Chromium — uses system WebView)
- Rust backend gives native file system access (load local `.csv`, `.dta`, `.shp` directly from disk — no drag-and-drop required)
- Auto-update via `tauri-plugin-updater` pointing to GitHub Releases

**Implementation:**
- Add `src-tauri/` directory with standard Tauri scaffold (`tauri.conf.json`, `Cargo.toml`, `main.rs`)
- `tauri.conf.json` build target: `src/` (existing Vite app), no changes to React code needed
- Rust commands exposed to frontend:
  - `read_file(path) → ArrayBuffer` — for loading files from arbitrary disk paths
  - `list_recent_files() → string[]` — MRU list for the Data tab "Open recent" feature
- `src/services/data/fileLoader.js` — detects Tauri (`window.__TAURI__`) and uses `invoke("read_file", { path })` instead of `<input type="file">`

**Auto-update strategy:**
- Tauri updater polls `https://litux.io/releases/latest.json` on startup
- `latest.json` is a static file updated on every Vercel deploy (via a Vercel build hook that writes the file to the CDN)
- Update dialog: *"A new version is available. Update now or later."* — inline, non-blocking

**New files:**
| File | Purpose |
|------|---------|
| `src-tauri/` | Full Tauri scaffold (generated by `cargo tauri init`) |
| `src/services/data/fileLoader.js` | Abstraction: web file input vs Tauri `read_file` command |

**Modified files:**
| File | Change |
|------|--------|
| `vite.config.js` | Add Tauri dev server config (`server.port = 1420`, `clearScreen = false`) |
| `src/DataStudio.jsx` | Use `fileLoader.js` instead of direct `<input>` for file loading |

---

### 15.2 — Offline AI Fallback — PENDING

When the user is offline (no internet) or has no Anthropic key set, AI features degrade gracefully:
- AI narrative → replaced by a deterministic template-based summary (uses `LocalAI.js`, already exists)
- AI unit inference → falls back to column name heuristics (already in codebase)
- AI coaching → shows rule-based signals only (already in `coachingTriggers.js`)

No new code required — just ensure the error handling in `AIService.js` falls through to `LocalAI.js` on network failure.

---

### 15.3 — Build & Release Pipeline — PENDING

**GitHub Actions workflow** (`releases.yml`):
1. On push to `main`: run `vite build`, deploy to Vercel (web version)
2. On tag `v*.*.*`: additionally run `cargo tauri build`, upload binaries to GitHub Releases (macOS `.dmg`, Windows `.msi`, Linux `.AppImage`)
3. After binaries upload: write `latest.json` to the CDN (triggers auto-update check in installed apps)

**New files:**
| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | Vercel deploy on push to main |
| `.github/workflows/releases.yml` | Tauri build + GitHub release on version tag |

---

### Phase 15 Build Order

1. **Tauri scaffold** — `cargo tauri init`; confirm app loads in Tauri WebView
2. **`fileLoader.js`** — abstract file loading; no behavior change on web
3. **`vite.config.js` Tauri dev mode** — `npm run tauri dev` works
4. **Rust `read_file` command** — enables drag-to-path and "Open recent"
5. **Auto-update config** — `tauri.conf.json` updater section + `latest.json` endpoint
6. **GitHub Actions** — deploy + release workflows
7. **Offline AI fallback** — verify `LocalAI.js` is called correctly on `fetch` error

---

## Overall Status Summary (last updated 2026-06-03)

| Phase | Title | Status |
|-------|-------|--------|
| 1 | Standardised Estimation Result | DONE |
| 2 | Advanced Context-Aware AI Coach | DONE |
| 3 | Multi-Model Comparison System | DONE |
| 4 | Integration | IN PROGRESS — multi-model export scripts only |
| 5 | New Estimators | DONE |
| 6 | Robust Standard Errors | DONE |
| 7 | New File Format Support | DONE |
| 8 | Modeling UI Overhaul | DONE |
| 9 | Workspace Architecture | DONE |
| 10 | Probability & Simulation Analytics | DONE |
| 11 | Spatial Analytics | IN PROGRESS — border clipping + Moran's I + Aggregate-to-Grid UI + Spatial RD shortcut remaining (Geocoding DONE) |
| 12 | Excel-style Cell Editing | DEFERRED |
| 13 | Project Isolation & User Auth | DONE (incl. 13.3 tier & access control) |
| 14 | Web Launch v0.1 Beta | DONE — Vercel deployed, API key settings, landing page, feedback modal all live |
| 15 | Local Installable Version (Tauri) | PENDING — blocked on 14 validation |

---

## Phase 11 Remaining — Spatial Module

### Done
- `SpatialEngine.js`: haversine, buffer, grid (rect + hex), point-in-polygon, spatial join, nearest neighbour, `assignBoundaryDistance` (Spatial RD running variable)
- `SpatialTab.jsx`: Analyze tab (Distance to Point, Buffer, Grid, **Spatial Join point-in-polygon — browser-validated 2026-06-03**, Nearest Neighbour, Distance to Boundary) + Plot tab (Boundary/Grid/Points layers with per-layer dataset selector)
- CSV auto-delimiter detection fixed (header-only sampling avoids WKT coordinate pollution)
- Delete sync: Data tab ↔ DatasetManager now bidirectional
- **SpatialTab 3-tab restructure** — Analyze / Map / Plot tabs; Map tab = Leaflet layer builder (renamed from "Plot") + "Download map.html" self-contained Leaflet HTML export; Plot tab = SpatialGeoPlot (Observable Plot static maps, WKT geometry layers, geographic axes, Mercator aspect ratio, per-layer dataset selector, height slider, full save/history/compare)
- **`pid` threading** — App.jsx passes `pid` to ModelingTab and SpatialTab; ModelingTab PlotBuilder instances namespaced `_model` / `_spec`; SpatialTab PlotBuilder namespaced `_spatial`

### Remaining (ordered by priority)

0. **Border cell clipping artifacts** — `makeGrid` `clipRectToRings` still produces diagonal artifacts at complex coastal boundaries (harbor inlets, peninsulas). Three approaches tried: angular sort (self-intersecting), convex hull (clips concave areas), same-edge re-entry detection (didn't help). Root cause: convex hull over-approximates non-convex intersections. Possible next approach: Sutherland-Hodgman polygon clipping (exact for convex clip region, i.e. the rect) applied directly to each boundary ring. The rect is convex so SH gives exact results regardless of boundary concavity.

0a. **Shapefile geometry — Italy ITA admin shapefile** — Fixes landed in `src/services/data/parsers/shapefile.js`:
    - **DONE — ESRI multi-ring → MULTIPOLYGON split**: shape-type 5 records with multiple disjoint outer rings (mainland + islands) were previously emitted as one POLYGON with rings 2…N reinterpreted as holes. Now correctly emitted as POLYGON or MULTIPOLYGON.
    - **DONE — Robust point-in-polygon ring classification**: real-world shapefiles (ISTAT, GADM, Natural Earth) ship rings in arbitrary orientation, so the previous signed-area heuristic dropped or misclassified rings whose orientation did not match the ESRI CW-outer convention. Replaced with GDAL/OGR/sf/PostGIS-style geometric containment: for each ring count enclosing rings via ray-cast point-in-polygon; even depth = outer, odd depth = hole of nearest enclosing outer. Output normalised to OGC SFS orientation (outer CCW, holes CW).
    - **DONE — Resilient SHP record loop**: a single malformed record header used to `break` the whole record loop, silently dropping every subsequent geometry (suspected cause of Sicily missing). Now emits `null` for the bad slot and continues.
    - **DONE — Ring closure + degenerate filter**: rings with < 4 vertices are dropped; open rings (first ≠ last vertex) are explicitly closed before classification.
    - **Open — `.prj` sidecar reprojection**: parse the `.prj` WKT alongside `.dbf`/`.shp`, feed to proj4js to reproject coords to WGS-84 inside the parser. Not the cause of the current visible offsets (data already in WGS-84 lon/lat), but needed for shapefiles delivered in UTM / ED50 / Roma40 / ETRS89-LAEA.
    - **Open — Italy fixture self-test**: load a known-good ITA shapefile and assert Sicily, Sardinia, mainland, Elba are each present as separate outer rings of the country MULTIPOLYGON.
    - **Note on residual coast offsets**: the ~100–300 m gap between rendered polygon edges and the OSM coastline (Elba, Liguria, Tuscan coast) is the normal mismatch between *administrative boundary* (the shapefile polygon — comune of Venezia includes the lagoon, coastal comuni include port basins and offshore territorial water) and *coastline* (the OSM tile basemap). `sf::st_read()` on the same source produces the same edges; this is expected, not a bug.

0a-legacy. — Previous symptom list, kept for history:
    - **Sicily renders with no boundary** at all (mainland + Sardinia outlined, Sicily missing) — see screenshot. Suspect: the Sicily record may be reaching `wktToLeaflet` as null or as a polygon whose first ring fails the `r.length >= 3` filter after `splitParenGroups` parsing; or its `__geometry` field is empty in the DBF row (record ordering mismatch).
    - **Systematic ~100–300 m offsets** between rendered polygon edges and the OSM coastline (Elba, Liguria, Tuscan coast). Likely candidates: (i) shapefile uses a non-WGS84 datum (ED50, Roma40, ETRS89-LAEA) and we never read the `.prj` sidecar — projected CRS reprojection was added but only triggers for explicit UTM/GK/RD/OSGB36 detection in `metadataExtractor.js`; (ii) lower-resolution coastline definition in the source shapefile.
    - **Next steps (when picked up):** (a) log per-record geometry parse results for the Italy shapefile and identify which record(s) drop out (Sicily); add a guard so `MULTIPOLYGON` parsing doesn't silently drop polygons whose first ring is CCW with no preceding CW outer; (b) parse `.prj` sidecar in the upload flow (DataStudio.jsx accepts .shp/.dbf/.shx — extend to .prj) and feed the WKT CRS into proj4js for reprojection to WGS-84; (c) add a self-test that loads a known-good Italy shapefile and asserts Sicily, Sardinia, mainland, Elba are all present as separate outer rings.

1. **Per-operation dataset selector in Analyze tab** — Distance to Point, Buffer, Grid, Spatial Join, Nearest Neighbour all use the active dataset for points. Should allow selecting any loaded dataset as the source (mirrors what Plot tab already does per layer). Needed when the enriched dataset is in a different tab than the active one.

2. ~~**Geocode — Address → Lat/Lon**~~ — DONE. Uses OpenStreetMap Nominatim, session-cached, adds `lat_geocoded` + `lon_geocoded` columns.

3. **Spatial autocorrelation (Moran's I)** — listed in HintBox tips but not implemented. Pure math: weight matrix (k-NN or distance band) + I statistic + permutation p-value. Needed for spatial econometrics diagnostics.

4. **Aggregate to Grid UI** — `aggregateToGrid()` exists in SpatialEngine but has no UI section. Counts/sums/means of point dataset within each grid cell. Useful for constructing density variables.

5. **Spatial RD estimator shortcut** — once `boundary_running` is computed in Spatial tab, add a one-click "Estimate RDD with this running variable" button that pre-fills the RDD estimator in Model tab (running var + treatment + bandwidth suggestion).

6. **Pipeline integration (architectural)** — see "Architectural Discussion" section below. Low urgency, high impact on reproducibility.

---

## Architectural Discussion — TO DISCUSS

### Pipeline scope redefinition (spatial + cross-module ops)

**Problem:** Spatial operations (distance, buffer, join, grid) currently run outside the pipeline and save results as new datasets via `onAddDataset` / `onMergeColumns`. This creates reproducibility and traceability gaps when:
- A spatial merge is followed by Clean Module steps (filter, rename, type cast)
- A derived column like `dist_km` is transformed (`* 1000`, log, z-score) in FeatureTab
- Simulated data is enriched spatially, modeled, and predicted values are saved back
- Multiple datasets are involved (multi-subset + spatial join + model)

The current pipeline is scoped to a single dataset and lives in `runner.js` (23 step types). Spatial ops are stateful side effects, not pipeline steps — this makes the audit trail incomplete and replication scripts wrong.

**Options to discuss:**
1. Add spatial step types to `runner.js` (e.g. `spatial_distance`, `spatial_join`, `spatial_buffer`) — pipeline becomes the single source of truth across all modules
2. Separate "spatial pipeline" that chains into the main pipeline output — looser coupling but cleaner module boundary
3. Keep spatial ops outside the pipeline but enforce a "checkpoint" pattern — user explicitly promotes a spatial result into a named pipeline input

**Blocker:** None — this is an architectural decision, not a bug. Low urgency but high impact on reproducibility and the replication bundle.

---

## Phase 16: Plot Builder History (Plot Pipeline) — DONE

Persistent plot history in the Plot Builder tab within ExplorerModule. Users save named plots inside a session, navigate them with arrows, and compare two side-by-side. History persists in IndexedDB scoped to `pid` — survives tab close and project re-open.

### Feature spec

**Save flow:**
- "Save plot" button in PlotBuilder toolbar saves current state: `{ id, name, layers[], title, xLabel, yLabel, scheme, savedAt }`
- Auto-name: "Plot 1", "Plot 2", ... (editable inline after save)
- "New plot" button clears builder (layers reset, labels reset, title reset)
- Builder does NOT auto-clear on save — user explicitly clicks "New" to start fresh

**Navigation:**
- `← →` arrow buttons in toolbar, showing `2 / 4` counter
- Clicking an arrow loads that plot's saved state into the builder (restores all layers + config)
- Keyboard shortcuts: `Alt+←` / `Alt+→`

**History strip (collapsible, below the plot):**
- Horizontal row of saved plot cards
- Each card: layer color dots + geom names + title (truncated) + `×` delete
- Click card → load that plot into builder
- Compare mode: checkbox on exactly 2 cards → side-by-side view below strip

**Persistence:**
- IndexedDB key: `plotHistory_<pid>` (array of saved plot objects, ordered by `savedAt`)
- Load on mount, save on every "Save plot" / delete action
- Uses existing `indexedDB.js` pattern (`openDB` → `get` / `put` on a general-purpose key-value store)

### Files to create/modify

| File | Change |
|------|--------|
| `src/services/Persistence/indexedDB.js` | Add `getPlotHistory(pid)` and `savePlotHistory(pid, history[])` |
| `src/components/PlotBuilder.jsx` | Add `plotHistory` state, Save/New buttons, `← →` nav, collapsible strip, compare mode |

### Build order

1. `indexedDB.js` — add `getPlotHistory` / `savePlotHistory` (2 functions, follows existing `loadPipeline` pattern)
2. PlotBuilder — history state + Save/New buttons + arrow nav
3. History strip — collapsible, card render, delete
4. Compare mode — side-by-side `PlotCanvas` for 2 selected history entries

---

## Phase 17: Plot Builder & Visualization Enhancements — IN PROGRESS

Ongoing improvements to PlotBuilder.jsx, ModelPlots.jsx, and SpatialTab.jsx to match and exceed ggplot2 quality. Driven by ggplot2-plot-design skill.

### Done
- Grouped boxplot (`fx` facet when `color` col ≠ `x` col) — mirrors `geom_boxplot(aes(fill=group))`
- Conditional zero rules — `ruleX/ruleY([0])` only when 0 is within ±20% of data range
- Scale expansion — `nice: true` + `inset: 8` on both axes (matches ggplot `expand = expansion(mult=0.05)`)
- Mark render order fixed: grid → zero rules → data → frame
- Per-layer geom options panel in `LayerEditorInline` (GeomOptsRow): size/shape for point; width/dash for line; SE/CI for smooth; outlier show/size for boxplot; bins for histogram; adjust for density; stroke for bar; width for errorbar
- SE toggle migrated from global toolbar to per-layer smooth opts
- PlotBuilder height fix in ExplorerModule (70vh) — prevents flex:1 collapse in scroll container
- Geom chips removed from LayerEditorInline row (redundant with layer tabs)
- `layer.aes.sizeCol` variable mapping for point size (`aes(size=col)` pattern)
- **Axis scale panel** — log/sqrt scale, manual domain limits (xlim/ylim), tick format (%, ,000, $) per axis — commit `cdf30fd`
- ~~**AI coach tab names**~~ — SHARED_CONTEXT + RESEARCH_COACH_PROMPT updated: Fuzzy RDD, factor_interactions, pivot_longer, trim/flag, Plot Builder nav — commit `fa195f6`
- ~~**Phase 2 boxplot opts**~~ — custom IQR implementation (Q1/Q3/whiskers/outlier dots), IQR coef slider, per-layer outlier color picker — commit `fa195f6`

### Pending (ordered by priority)
1. **More arguments and labels in Plot Builder, Model, and Spatial Map** — audit model plots for missing ggplot2-equivalent params; spatial map labels/annotations
2. ~~**Variable mapping for alpha**~~ — DONE (per user confirmation)
3. **Style presets (Phase 9.9)** — Journal / Presentation / Minimal presets at export time
4. ~~**Spatial map labels and annotations**~~ — DONE: SpatialTab restructured to 3 tabs (Analyze / Map / Plot); Map tab = Leaflet layer builder + "Download map.html" self-contained export; Plot tab = new SpatialGeoPlot component (Observable Plot, WKT geometry, geographic axes °N/S/°W/E, Mercator aspect ratio, per-layer dataset selector, height slider, save/history/compare pattern); `pid` threaded from App.jsx → ModelingTab + SpatialTab with `_model`/`_spec` namespace suffixes

---

## Next unblocked tasks

1. **Open bug backlog (ClaudeFB.md)** — work through remaining bugs:
   - ~~`[2026-05-08] Data` — Big datasets crashes (>900k rows) → DuckDB model-frame builder~~ ✓ DONE
   - `[2026-05-10] Data` — CSV parse error line 1583 (DuckDB CSV reader edge case)
   - ~~`[2026-05-11] Data` — Edit cells button does not work~~ ✓ DONE (minor bugs remain)
   - ~~`[2026-05-11] Explore` — Graph does not fit screen~~ ✓ DONE
   - ~~`[2026-05-13] Data` — .dta files wrongly loaded/read~~ ✓ DONE (commit d11d34c: .dta format-119 fix)
   - ~~`[2026-05-13] Spatial` — Multipolygon geometry does not work~~ ✓ DONE
   - `[2026-05-13] Spatial` — Grids: clip border cells (Sutherland-Hodgman)
   - ~~`[2026-05-13] Model` — "Matrix is singular" needs specific error~~ ✓ DONE

2. **Phase 4 — multi-model export scripts** — verify R/Python/Stata export buttons in ModelComparison generate correctly for 3+ pinned models.

3. **Phase 13.3 — tier & access control** — `usePremium()` hook + upgrade modal. Unblocks premium gating for AI features.

4. **Codex stabilization sprint remaining items**:
   - Edit-cells E2E verification + `patch` step tests (Codex §2)
   - DuckDB model-frame builder for OLS (Codex §3)
   - Lock Supabase `claude-proxy` (JWT + tier + rate limits) (Codex §4)
   - Smoke tests for pipeline replay, patch, group_summarize, OLS (Codex §3 of stabilization)

5. **Phase 15 — Tauri** — after 14 is validated in production.

### Completed since last update (2026-06-03)
- ✓ Codex §1 lint cleanup — 55 bugs surfaced, 7 critical runtime bombs fixed (no-undef, hook-order)
- ✓ Geocoding (Phase 11.2) — Nominatim integration
- ✓ Web Launch (Phase 14) — Vercel deployed
- ✓ README replaced (Vite-template → user/dev docs)
- ✓ Sun-Abraham (2021) event study estimator — `NonLinearEngine.js` `runSunAbraham`, harness `sunAbrahamValidation.js`, R script `sunAbrahamRValidation.R`, all green; wired end-to-end in ModelingTab (commit d11d34c)
- ✓ CoefficientTestPanel — `src/components/modeling/CoefficientTestPanel.jsx` post-estimation hypothesis test on pinned model coefficients (commit d11d34c)
- ✓ OECD proxy fix and dataset delete — OECD fetcher fixed, dataset delete wired bidirectionally (commit d11d34c)
- ✓ .dta format-119 fix — Stata file loading corrected for format 119 (commit d11d34c)
- ✓ Callaway-Sant'Anna (2021) staggered DiD — `src/math/CallawayEngine.js`, harness `callawayValidation.js` + R script; wired in EstimatorSidebar / ModelConfiguration / ModelingTab (commit ec7aed3)
- ✓ Estimator-aware AI prompts — SHARED_CONTEXT + prompts updated for new estimators (commit ec7aed3)
- ✓ CalculateTab cleanup — workbench refactor, new subcomponents under `src/components/calculate/workbench/` (commit ec7aed3)

---

## Phase 16: Artifact Replication for Report-AI (Premium)

### Context

Pipeline + models are already replicated well by Report-AI via `sessionSnapshot.js` + `UNIFIED_SCRIPT_PROMPT`. What's missing: **plots, maps, summary tables, histograms, function plots, and Monte Carlo simulations** are not emitted in the generated R/Python/Stata scripts. This phase adds a curated, premium-only artifact replication system: users pin the specific artifacts they want replicated, and the AI emits per-language code for each one.

### Design decisions (locked 2026-05-26)

| Decision | Choice |
|---|---|
| Pinning UX | 📌 button like model-pin; one click; no forced label (auto-generated from spec) |
| Tier | Premium-only. Free tier gets pipeline+models only, as today. |
| Granularity | One pin = one artifact. No collapsing across subsets/variables. |
| Per-subset replication | Always separate pins (no loops) — users tweak bins/colors per subset |
| Script ordering | Grouped by type in output (histograms → scatters → maps → tables → simulations) |
| User preferences | Free-form text box in ReportingModule, optional, injected verbatim into AI prompt |

### Architecture

#### New file: `src/services/AI/artifactRegistry.js`

```js
// Artifact shape
{
  id, module, type, label, spec, createdAt, pid
}
```

Exports:
- `pinArtifact(pid, artifact) → Promise<id>`
- `unpinArtifact(pid, id) → Promise<void>`
- `listArtifacts(pid, module?) → Promise<Artifact[]>`
- `updateArtifact(pid, id, patch) → Promise<void>`
- `reorderArtifacts(pid, newOrder) → Promise<void>` (manual reorder within type group)

Storage: IndexedDB store `artifacts` (pid-scoped), mirrors `services/Persistence/plotHistory.js` pattern.

#### New file: `src/services/auth/tier.js`

```js
export function isPremium() { return true; }  // stub until auth ships
```

When K-track auth lands, this reads from user session.

#### New file: `src/components/shared/PinButton.jsx`

Shared component: `<PinButton artifact={{ module, type, spec }} label?={string} />`

Behavior:
- Free tier → disabled, tooltip "Pin for replication (Premium)"
- Premium → one click pins to registry, button flips to "📌 Pinned" with unpin-on-click
- Auto-generates label from spec if not provided

#### Per-type artifact specs

| Type | Module | Spec |
|---|---|---|
| `histogram` | Explore | `{ column, bins, weight? }` |
| `density` | Explore | `{ column, adjust? }` |
| `scatter` | Explore | `{ x, y, color?, smooth? }` |
| `acf_pacf` | Explore | `{ column, lags, type: "acf"|"pacf" }` |
| `summary_table` | Data/Explore | `{ columns, stats: ["mean","sd","min","max","n"] }` |
| `plot_builder` | Explore/Modeling | full PlotBuilder JSON (already serialized in plotHistory) |
| `map` | Spatial | `{ wktCol?, latCol?, lonCol?, basemap, polygonColor? }` |
| `function_plot` | Calculate | `{ funcs, params, xRange, quadrant }` |
| `monte_carlo` | Simulate | `{ expr, N, seed, dists }` |

#### ReportingModule extensions

New section **"Pinned for replication"**:
- List of pinned artifacts, grouped by type (collapsed groups)
- Per item: label (editable), delete, manual reorder within group
- Empty state explains how to pin

New textbox **"Script preferences (optional)"**:
- 4-line free-form text
- Examples shown as placeholder: "use base R not tidyverse · comment in Spanish · round to 4 decimals"
- Injected as Rule 10 in AI prompt

#### `sessionSnapshot.js` extension

```js
{
  ...existingSnapshot,
  artifacts: await listArtifacts(pid),  // already grouped by type before serializing
  preferences: reportingPreferencesText || ""
}
```

#### `UNIFIED_SCRIPT_PROMPT` additions

- **Rule 9** — for each pinned artifact, emit replication code in target language. Use spec-to-code helpers per language.
- **Rule 10** — if `preferences` is non-empty, apply user preferences across the entire script.

#### Per-language emitters

New helpers in existing files (one function per artifact type):

**`services/export/rScript.js`**:
- `rHistogram(spec, dfVar)` → `ggplot(... geom_histogram(bins=...))`
- `rDensity(spec, dfVar)` → `ggplot(... geom_density())`
- `rScatter(spec, dfVar)` → `ggplot(... geom_point() + smooth)`
- `rACF(spec, dfVar)` → `acf(...)` / `pacf(...)`
- `rSummaryTable(spec, dfVar)` → `modelsummary::datasummary(...)`
- `rMap(spec, dfVar)` → `leaflet::leaflet() %>% addTiles() %>% addPolygons()`
- `rFunctionPlot(spec)` → `ggplot(data.frame(x=...)) + stat_function(...)`
- `rMonteCarlo(spec)` → `replicate(N, ...)` + histogram

**`services/export/pythonScript.js`**: equivalents using `matplotlib`/`seaborn`/`folium`/`statsmodels`

**`services/export/stataScript.js`**: equivalents using `histogram`, `summarize`, `corr`, etc. Maps use the export+merge workaround already established for geocoding.

### Phasing

1. **Foundation** — `artifactRegistry.js` + IndexedDB schema + `isPremium()` stub + `<PinButton>` shared component
2. **ReportingModule UI** — "Pinned for replication" list section + "Script preferences" textbox
3. **PlotBuilder + Explore** — wire PinButton to PlotBuilder header, histogram/density/scatter/ACF panels, summary table panel
4. **Spatial** — wire to GeoPlotCanvas + Leaflet map header
5. **Calculate + Simulate** — function plots + Monte Carlo result panel
6. **AI prompt + emitters** — `UNIFIED_SCRIPT_PROMPT` rules 9/10 + per-language spec-to-code helpers for all artifact types
7. **Premium gate live** — replace `isPremium()` stub with real check (gated on K-track auth)

### Validation

After each phase: load a dataset, pin one artifact of the new type, generate R/Python/Stata script, verify the artifact code appears in the script and runs to produce the expected output.

### Files added/modified

**New files**:
- `src/services/AI/artifactRegistry.js`
- `src/services/auth/tier.js`
- `src/components/shared/PinButton.jsx`

**Modified files**:
- `src/services/AI/sessionSnapshot.js` — include `artifacts` + `preferences`
- `src/services/AI/Prompts/index.js` — `UNIFIED_SCRIPT_PROMPT` rules 9/10
- `src/services/export/rScript.js` / `pythonScript.js` / `stataScript.js` — per-type emitters
- `src/ReportingModule.jsx` — pinned list section + preferences textbox
- `src/components/PlotBuilder.jsx` — PinButton in header
- `src/ExplorerModule.jsx` — PinButton on histograms/density/scatter/ACF/summary panels
- `src/components/tabs/SpatialTab.jsx` — PinButton on map + GeoPlotCanvas
- `src/components/tabs/CalculateTab.jsx` — PinButton on function plot
- `src/components/tabs/SimulateTab.jsx` — PinButton on Monte Carlo result
- `src/services/Persistence/indexedDB.js` — new `artifacts` object store

### Status: PENDING — start with Phase 16.1 (Foundation) when ready

---

# Phase 17: SpatialTab.jsx file split — PENDING

## Goal & rationale

`src/components/tabs/SpatialTab.jsx` is **3908 lines** doing too many jobs: analyze tools, Leaflet map builder, Observable/SVG static plot, WKT parsing, CRS/proj4, color scales, UI atoms, and the root tab shell. Split it into a `spatial/` directory so Franco, Codex, and Claude can work in parallel without collisions.

**This is a PURE MOVE refactor — verbatim code relocation, zero logic changes.** Do not "improve," rename, or rewrite any function while moving it. Surgical discipline (per `feedback_code_style`): move the exact bytes, add imports/exports only.

**Timing:** Execute only AFTER the current spatial workflow is browser-validated by Franco. Confirm with him before starting — he was leaning toward deferring.

## Why the split is low-risk (verified 2026-05-31)

Coupling is loose. The root (now line 3691) passes plain props down: `rows, headers, availableDatasets, onAddDataset, pid, C`. The three tabs are nearly independent:
- **Analyze sections** communicate back ONLY via one callback contract: `onResult(rows, newCols, headers?)` → `pendingRows`/`pendingCols`/`pendingHeaders` state in root → sticky `OutputPanel` save bar → `handleSave` → `onAddDataset`.
- **Map tab** (`SpatialPlotTab`) and **Plot tab** (`SpatialGeoPlot`) are fully self-contained (own layers, history, export codegen).

## INVARIANTS (do not break)
1. **Default export path stays:** `src/components/tabs/SpatialTab.jsx` remains the root file with `export default function SpatialTab(...)`. No other importer in the codebase changes. (Verify: `grep -rn "tabs/SpatialTab" src/` before and after — should be identical.)
2. **Verbatim move only** — no logic edits, no renames, no reformatting.
3. **Skill applies:** `spatial-module` auto-triggers on this file. Re-read it each session.
4. **Validate after each tab group** in the browser (Analyze, Map, Plot independently) — Franco's convention.

## Orphaned / parked components — DECISION REQUIRED before moving
- `SpatialMapSection` (1548–1807) and `SpatialRDDSection` (1902–2051) are **defined but NEVER rendered** by the root. `SpatialRDDSection` is likely intentional WIP (uses `runSpatialRDD` from `SpatialRDDEngine.js`). **Do NOT delete** — investigate/ask Franco. Park them in `spatial/analyze/_parked/` and leave them unimported, OR wire them if Franco confirms they should be live.
- `MapLegend` (1507–1547) is used by the dead `SpatialMapSection` (1801) AND the live Map tab `SpatialPlotTab` (2846). Move to `spatial/map/MapLegend.jsx`; parked section imports from there.

## Target structure

```
src/components/tabs/
├── SpatialTab.jsx                    ← STAYS: root tabs + shared pending-result state only (~current 3691–3908)
└── spatial/
    ├── shared/
    │   ├── constants.js   ← mono, arrMin, arrMax, BUFFER_RADIUS_PRESETS, formatRadiusLabel
    │   ├── leaflet.js     ← BASEMAPS, CARTO_TILE, lonToTx/latToTy/txToLon/tyToLat, pickTileZ, addBasemap, loadLeaflet
    │   ├── crs.js         ← loadProj4, PRESET_CRS, isProjectedWKT, makeCabaMetricGrid
    │   ├── wkt.js         ← splitParenGroups, leafletPolygonLatLngs, wktToLeaflet, parseWktRings
    │   ├── color.js       ← CAT_PALETTE, buildColorScale
    │   ├── guess.js       ← guessLatCol/LonCol/WktCol/PointCountCol/AddressCol, looksLikeWktValue, isGeometryHeader
    │   └── atoms.jsx      ← ColSelect, NumInput, TextInput, ApplyBtn, SaveBtn, ResultPreview, ErrBanner, Section
    ├── analyze/
    │   ├── CRSTransformSection.jsx
    │   ├── DistanceSection.jsx
    │   ├── BufferSection.jsx
    │   ├── MetricBufferSection.jsx
    │   ├── GridSection.jsx
    │   ├── SpatialJoinSection.jsx
    │   ├── AggregateToGridSection.jsx
    │   ├── NearestNeighborSection.jsx
    │   ├── GeocodeSection.jsx
    │   ├── BoundaryDistanceSection.jsx
    │   ├── OutputPanel.jsx
    │   └── _parked/  ← SpatialMapSection.jsx, SpatialRDDSection.jsx (unrendered; see decision above)
    ├── map/
    │   ├── SpatialPlotTab.jsx
    │   ├── SpatialLayerEditor.jsx
    │   ├── ColorRow.jsx
    │   ├── MapLegend.jsx
    │   └── layers.js      ← LAYER_COLORS, mkSLayer
    └── plot/
        ├── SpatialGeoPlot.jsx
        ├── GeoPlotCanvas.jsx
        ├── GeoLayerConfig.jsx
        ├── legend.js       ← GEO_MARGIN, appendSvgLegend
        └── geo.js          ← loadGeoPlt, geoBbox, GEO_COLORS, mkGeoLayer
```

## Symbol → file map with ORIGINAL line ranges (snapshot @ 3908-line version)

> Line numbers drift as you extract. Move by **symbol boundary** (`function X`/`const X` to just before next top-level def). Use these only to locate the symbol.

| Symbol | Orig lines | Destination |
|---|---|---|
| `arrMin`, `arrMax` | 8–9 | shared/constants.js |
| `mono` | 43 | shared/constants.js |
| `BUFFER_RADIUS_PRESETS`, `formatRadiusLabel` | 44–58 | shared/constants.js |
| `BASEMAPS`, `CARTO_TILE`, `lonToTx`,`latToTy`,`txToLon`,`tyToLat`,`pickTileZ`,`addBasemap`,`loadLeaflet` | 60–127 | shared/leaflet.js |
| `loadProj4`, `PRESET_CRS`, `isProjectedWKT`, `makeCabaMetricGrid` | 130–172 | shared/crs.js |
| `splitParenGroups`, `leafletPolygonLatLngs`, `wktToLeaflet` | 174–252 | shared/wkt.js |
| `CAT_PALETTE`, `buildColorScale` | 253–298 | shared/color.js |
| `ColSelect`,`NumInput`,`TextInput`,`ApplyBtn`,`SaveBtn`,`ResultPreview`,`ErrBanner`,`Section` | 299–484 | shared/atoms.jsx |
| `guessLatCol`,`guessLonCol`,`guessWktCol`,`guessPointCountCol`,`looksLikeWktValue`,`isGeometryHeader`,`guessAddressCol` | 485–520 | shared/guess.js |
| `CRSTransformSection` | 521–606 | analyze/CRSTransformSection.jsx |
| `DistanceSection` | 607–668 | analyze/DistanceSection.jsx |
| `BufferSection` | 669–720 | analyze/BufferSection.jsx |
| `MetricBufferSection` | 721–852 | analyze/MetricBufferSection.jsx |
| `GridSection` | 853–1004 | analyze/GridSection.jsx |
| `SpatialJoinSection` | 1005–1136 | analyze/SpatialJoinSection.jsx |
| `AggregateToGridSection` | 1137–1246 | analyze/AggregateToGridSection.jsx |
| `NearestNeighborSection` | 1247–1356 | analyze/NearestNeighborSection.jsx |
| `GeocodeSection` | 1357–1506 | analyze/GeocodeSection.jsx |
| `MapLegend` | 1507–1547 | map/MapLegend.jsx |
| `SpatialMapSection` (PARKED) | 1548–1807 | analyze/_parked/SpatialMapSection.jsx |
| `BoundaryDistanceSection` | 1808–1901 | analyze/BoundaryDistanceSection.jsx |
| `SpatialRDDSection` (PARKED) | 1902–2051 | analyze/_parked/SpatialRDDSection.jsx |
| `OutputPanel` | 2052–2084 | analyze/OutputPanel.jsx |
| `ColorRow` | 2085–2103 | map/ColorRow.jsx |
| `SpatialLayerEditor` | 2104–2257 | map/SpatialLayerEditor.jsx |
| `LAYER_COLORS`, `mkSLayer` | 2258–2268 | map/layers.js |
| `SpatialPlotTab` | 2269–2862 | map/SpatialPlotTab.jsx |
| `loadGeoPlt`, `parseWktRings` | 2864–2913 | geo.js / **wkt.js** (parseWktRings → shared/wkt.js) |
| `geoBbox`, `GEO_COLORS`, `mkGeoLayer` | 2915–2951 | plot/geo.js |
| `GeoLayerConfig` | 2952–3079 | plot/GeoLayerConfig.jsx |
| `GEO_MARGIN`, `appendSvgLegend` | 3080–3174 | plot/legend.js |
| `GeoPlotCanvas` | 3175–3447 | plot/GeoPlotCanvas.jsx |
| `SpatialGeoPlot` | 3448–3690 | plot/SpatialGeoPlot.jsx |
| `SpatialTab` (default export) | 3691–3908 | STAYS in SpatialTab.jsx |

## Cross-tab shared-symbol usage (verified — drives the import lists)

| Shared symbol | Used by |
|---|---|
| `wktToLeaflet` | analyze(parked SpatialMapSection), **map** |
| `buildColorScale` | analyze(parked), **map**, **plot** |
| `loadLeaflet` | analyze(parked), **map**, **root** |
| `BASEMAPS`, `addBasemap` | analyze(parked), **map** |
| `makeCabaMetricGrid` | **map**, **plot** |
| `isProjectedWKT`, `loadProj4`, `PRESET_CRS` | **map** |
| `parseWktRings` | **plot** only (but place in shared/wkt.js for cohesion) |
| `geoBbox` | **plot** only |
| `BUFFER_RADIUS_PRESETS` | analyze(BufferSection) |
| `formatRadiusLabel` | analyze(MetricBufferSection) |
| `mono`, `arrMin`, `arrMax`, atoms, guess helpers | all tabs |

External imports currently at top of file (lines 6–41) — redistribute per consumer: `useTheme`, `HintBox`, `getPlotHistory/savePlotHistory` (plot only), `geocoding.js` (GeocodeSection only), `SpatialEngine.js` exports (per analyze section), `runSpatialRDD` (parked SpatialRDDSection), `wrapResult` + `modelBuffer` (SpatialRDDSection — confirm).

## Execution order (each step = build-clean checkpoint; commit after each)

> **BROWSER-VALIDATED by Franco 2026-05-31** — all 3 tabs (Analyze / Map / Plot) confirmed working after the full split. Refactor complete.


- [x] **Step 0** — Franco approved executing now (2026-05-31). `spatial/` dirs created. `_parked` decision: park unrendered components unimported (no deletion).
- [x] **Step 1 — shared/** — DONE (2026-05-31). Extracted `constants.js`, `leaflet.js`, `crs.js`, `wkt.js` (incl. `parseWktRings`), `color.js`, `guess.js`, `atoms.jsx`. Root imports them; duplicate local `parseWktRings` removed from plot region. `vite build` green (367 modules).
- [x] **Step 2 — analyze/** — DONE (2026-05-31). 10 live `*Section` + `OutputPanel` moved into `analyze/`, per-file imports auto-detected. Root imports them. `vite build` green; `eslint` 0 `no-undef`. (Pre-existing React-Compiler memoization warnings carried over verbatim — do NOT "fix" as part of this move.) **Browser validation of Analyze tab still pending.**
- [x] **Step 3 — map/** — DONE 2026-05-31. Moved `ColorRow`, `SpatialLayerEditor`, `MapLegend`, `layers.js`, `SpatialPlotTab` (extracted together with Step 5 parked block, root lines 77-1305). Build green, 0 no-undef. **Validate Map tab in browser** (live Leaflet builder + HTML export).
- [x] **Step 4 — plot/** — DONE 2026-05-31. Moved `geo.js` (loadGeoPlt/geoBbox/GEO_COLORS/mkGeoLayer), `legend.js` (GEO_MARGIN/appendSvgLegend), `GeoLayerConfig.jsx`, `GeoPlotCanvas.jsx`, `SpatialGeoPlot.jsx`. Note: `GeoPlotCanvas` needed crs/leaflet basemap imports (makeCabaMetricGrid, CARTO_TILE, lonToTx/latToTy/txToLon/tyToLat, pickTileZ) — caught by eslint no-undef. Build green, 0 no-undef. **Validate Plot tab in browser** (SVG render, legend, PNG/SVG export, history persist/restore).
- [x] **Step 5 — _parked/** — DONE 2026-05-31. Moved `SpatialMapSection` + `SpatialRDDSection` into `analyze/_parked/` (5-up import depth). Kept unimported per Step 0 decision. eslint 0 no-undef.
- [x] **Step 6 — Final** — DONE 2026-05-31. `grep -rn "tabs/SpatialTab" src/` unchanged (only `App.jsx` imports it). `SpatialTab.jsx` now **245 lines** (was 3908). Unused root imports pruned (eslint 0 no-undef + 0 unused-vars). Full app `vite build` green. Final tree: `spatial/shared/` (7), `spatial/analyze/` (11 + `_parked/` 2), `spatial/map/` (5), `spatial/plot/` (5) = 30 files. update-structure: refresh CLAUDE.md file-structure section. **Browser validation of all 3 tabs pending (Franco).** Commit pending (Franco PRs to main himself).

## Resume protocol (for a fresh low-context session)
1. Re-read this Phase 17 section + invoke `spatial-module` skill.
2. Check progress: `ls src/components/tabs/spatial/**` — directories/files already present tell you which steps are done.
3. `grep -n "^function\|^const\|^export default" src/components/tabs/SpatialTab.jsx` — whatever symbols REMAIN in the root file (beyond `SpatialTab` itself) are not yet extracted.
4. Continue from the first unchecked step above. Build green + browser-validate before checking a box.
5. Remember: verbatim moves only; default export path immutable.

### Status: PENDING — awaiting Franco's go-ahead (validate spatial workflow first)
