# Staggered DiD Algorithm

## Base Period Indexing

gStar = g - anticipation

**Universal base**: b = largest t < gStar (fixed for all cells in cohort g)
- Reference cell emitted at t=b with att=0, isRef=true
- All pre and post cells use same b

**Varying base**:
- Post cells (t >= gStar): b = largest t < gStar
- Pre cells (t < gStar): b = immediately preceding t in tlist

Skip cell if b is undefined or t === b.
e = t - g, isPre = (t < gStar)

## Control Groups

**nevertreated**: units with G = Infinity
- Falls back to notyettreated if no never-treated exist (with warning)

**notyettreated**: units with G > max(t, b) and G ≠ g
- Includes never-treated since Infinity > any finite period

## Mammen Bootstrap

V_i ~ Mammen: P(V = -(√5-1)/2) = (√5+1)/(2√5) ≈ 0.724
For B draws: boot_k = (1/n) Σ V_i · IF_k_i
SE_k = IQR(boot_k) / 1.3489795
critVal = 95th percentile of max_k |boot_k|/SE_k  (uniform band)

## Wald Pre-test

θ = vector of pre-period ATT(g,t) estimates (should all be 0)
Σ = (1/n) IF'IF   (m×m covariance)
stat = n · θ' Σ⁻¹ θ ~ χ²(m)
