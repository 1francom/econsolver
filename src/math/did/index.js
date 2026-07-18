// ─── ECON STUDIO · src/math/did/index.js ──────────────────────────────────────
// Barrel export for the Callaway-Sant'Anna DiD building blocks.
// enumerateCells, controlSet, aggregate will be added by later tasks.

export { compute2x2 } from "./drdid.js";
export { enumerateCells, controlSet, aggregate } from "./staggeredDiD.js";
export { runBaconDecomposition, checkBaconIdentity, BACON_TYPES } from "./baconDecomp.js";
