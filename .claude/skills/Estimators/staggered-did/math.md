# Staggered DiD Math — Callaway & Sant'Anna (2021)

## ATT(g,t)

For cohort g (units first treated at g), period t, against control set C:

ATT(g,t) = E[Y_t(g) - Y_t(∞) | G=g]

Estimated via doubly-robust 2×2 DiD (Sant'Anna & Zhao 2020):
- Outcome regression (OR): OLS ΔY ~ X on control units at (t, b)
- Propensity score (PS): logit P(G=g | G∈{g}∪C, X) on pooled sample
- DR: combines OR and PS, doubly robust

ΔY_i = Y_i,t - Y_i,b  (outcome difference from base period b)
D_i = 1{G_i = g}       (focal cohort indicator)

att = mean_treated(ΔY - OR) - mean_control_IPW(ΔY - OR)

## Four Aggregations

**Simple**: weighted average of ATT(g,t) for all post cells, weights ∝ P(G=g)
**Dynamic (event study)**: θ(e) = E[ATT(g, g+e) | G+e observed], overall = mean over e≥0
**Group**: θ(g) = mean_t ATT(g,t) for t≥g, overall = Σ_g θ(g)·P(G=g)
**Calendar**: θ(t) = mean_g ATT(g,t) for g≤t, overall = mean_t θ(t)

## Influence Function

IF_i = Σ_k w_k · IF_k_i  (linear combination of 2×2 cell IFs)
SE = sqrt(Σ IF_i²) / n   (where n = total units)

Mammen multiplier bootstrap gives uniform (simultaneous) CI bands.
