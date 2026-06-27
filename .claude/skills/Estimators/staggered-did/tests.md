# CS DiD Validation

## R fixture generation

Run: `Rscript src/math/__validation__/callawayRValidation.R`
Requires: R packages `did`, `dplyr`, `jsonlite`
Output: `src/math/__validation__/callawayBenchmarks.json`

## Tolerance

| Quantity | Tolerance |
|----------|-----------|
| ATT(g,t) per cell | 1e-4 |
| Aggregation overall ATT | 1e-4 |
| Analytic SE | 1e-3 |
| Bootstrap critVal | structural (> 1.96 for balanced panels) |

## Known differences from R `did`

- Bootstrap RNG: JS uses seeded LCG (Mammen draws), R uses `set.seed`. Results will differ in bootstrap SEs; analytic SEs should match to 1e-3.
- groupProb: JS uses P(G=g) over full panel; R `did` conditions on treated (minor difference for large never-treated fraction).
- Weight-correction term in aggregation IF: JS omits the ∂w/∂p_g correction — affects SE by ~1-2% in typical panels.

## Validation status (2026-06-27)

- drdid.js (2×2 DR): R fixtures pending Franco's run
- CallawayEngine.js: synthetic DGP suite green (no R fixtures yet)
- Full R comparison: PENDING — Franco must run callawayRValidation.R
