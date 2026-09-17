// ─── ECON STUDIO · services/export/exportSpecExtras.js ───────────────────────
// Estimator-specific spec fields every exporter needs, read off a result in one
// place. CodeEditor, ReportingModule and ModelComparison each build their own
// export config by hand, and every field missing from one of them silently
// degraded that export only — WLS lost its weights (all three languages fitted
// OLS), Event Study lost its treatment-time column and window. Spread this
// FIRST in each config, so the fields a builder sets explicitly still win.

export function exportSpecExtras(result) {
  const r    = result ?? {};
  const spec = r.spec ?? r.fe?.spec ?? r.fd?.spec ?? {};
  const pick = (k) => spec[k] ?? r[k] ?? null;
  return {
    weightCol:    pick("weightCol"),
    offsetCol:    pick("offsetCol"),
    feCols:       pick("feCols"),
    treatTimeCol: pick("treatTimeCol"),
    windowPre:    r.windowPre  ?? spec.windowPre  ?? null,
    windowPost:   r.windowPost ?? spec.windowPost ?? null,
    treatedUnit:  pick("treatedUnit"),
    treatTime:    pick("treatTime"),
    cohortCol:    pick("cohortCol"),
    periodCol:    pick("periodCol"),
    controlMode:  pick("controlMode"),
    refPeriod:    pick("refPeriod"),
    treatCol:     pick("treatCol"),
    compGroup:    pick("compGroup"),
    estMethod:    pick("estMethod"),
    anticipation: pick("anticipation"),
    basePeriod:   pick("basePeriod"),
  };
}
