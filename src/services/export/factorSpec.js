// ─── ECON STUDIO · services/export/factorSpec.js ─────────────────────────────
// Recovers the PRE-EXPANSION model spec that the replication exporters need in
// order to emit `factor(municipality)` / `C(municipality)` / `i.municipality`
// instead of listing all 94 dummy columns as separate regressors.
//
// Two sources, in order of trust:
//
//   1. spec.xVarsRaw / spec.factorVars / spec.factorRefs — stamped onto every
//      result by ModelingTab's specExtras. Authoritative when present.
//   2. result.factorMap — the dummy -> {factor, level, ref} map emitted by
//      applyFactors. Used for models pinned before specExtras carried the raw
//      lists, or restored from a build that did not persist them.
//
// Pure JS, no React, no engine deps.

// Column names for interaction products are `a:b` (expandInteractions). Splitting
// on the separator lets each side be mapped back to its factor independently.
const IX_SPLIT = /\s*[:×·*]\s*/;

function collapseVars(vars, fmap) {
  const main = [];
  const interactions = [];
  for (const v of vars ?? []) {
    const parts = String(v).split(IX_SPLIT).filter(Boolean);
    const srcs = parts.map(p => fmap[p]?.factor ?? p);
    if (srcs.length >= 2) {
      // Emit as ":" (product only). The expansion adds main effects as their own
      // columns when the term was "*", and those are collapsed above, so the
      // design matrix is reproduced either way — whereas guessing "*" here would
      // duplicate main effects that are already in the list.
      const key = srcs.slice(0, 2).join("|");
      if (!interactions.some(t => `${t.var1}|${t.var2}` === key)) {
        interactions.push({ var1: srcs[0], var2: srcs[1], type: ":" });
      }
    } else if (!main.includes(srcs[0])) {
      main.push(srcs[0]);
    }
  }
  return { main, interactions };
}

/**
 * @param  {object} m  A pinned/estimated result (needs .spec and/or .factorMap)
 * @returns {{factorVars:string[], factorRefs:object, xVarsRaw:string[]|null,
 *            wVarsRaw:string[]|null, interactionTerms:object[]}}
 */
export function deriveFactorSpec(m) {
  const spec = m?.spec ?? {};
  const specFactors = Array.isArray(spec.factorVars) ? spec.factorVars : [...(spec.factorVars ?? [])];

  // Path 1 — the live spec already carries the pre-expansion lists.
  if (Array.isArray(spec.xVarsRaw) && spec.xVarsRaw.length) {
    return {
      factorVars:       specFactors,
      factorRefs:       spec.factorRefs ?? {},
      xVarsRaw:         spec.xVarsRaw,
      wVarsRaw:         Array.isArray(spec.wVarsRaw) ? spec.wVarsRaw : [],
      interactionTerms: spec.interactionTerms ?? [],
    };
  }

  // Path 2 — rebuild from the expansion's own map.
  const fmap = m?.factorMap ?? {};
  if (!Object.keys(fmap).length) {
    return {
      factorVars: specFactors,
      factorRefs: spec.factorRefs ?? {},
      xVarsRaw:   Array.isArray(spec.xVarsRaw) ? spec.xVarsRaw : null,
      wVarsRaw:   Array.isArray(spec.wVarsRaw) ? spec.wVarsRaw : null,
      interactionTerms: spec.interactionTerms ?? [],
    };
  }

  const factorVars = [];
  const factorRefs = {};
  for (const { factor, ref } of Object.values(fmap)) {
    if (!factorVars.includes(factor)) factorVars.push(factor);
    // Every dummy of a factor carries the same ref; last write is identical.
    if (ref != null) factorRefs[factor] = ref;
  }

  const x = collapseVars(spec.xVars ?? m?.xVars ?? [], fmap);
  const w = collapseVars(spec.wVars ?? m?.wVars ?? [], fmap);

  return {
    factorVars,
    factorRefs,
    xVarsRaw: x.main,
    wVarsRaw: w.main,
    interactionTerms: [...(spec.interactionTerms ?? []), ...x.interactions, ...w.interactions],
  };
}
