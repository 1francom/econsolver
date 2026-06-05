// ─── ECON STUDIO · services/AI/appCapabilityMap.js ───────────────────────────
// Derives the AI's knowledge of the pipeline vocabulary from STEP_REGISTRY so
// it never drifts. Used by the NL command bar (allowed-step catalogue) and,
// later, by the research coach (capability map).
import { STEP_REGISTRY } from "../../pipeline/registry.js";

// Coarse type hint for each schema field, so the model knows what to emit.
function fieldHint(field) {
  if (field.type === "select" && Array.isArray(field.options)) {
    return `${field.key}:one-of[${field.options.map(o => o.value).join("|")}]`;
  }
  return `${field.key}:${field.type}`;
}

// Produce a compact catalogue of the steps the AI is allowed to emit.
// allowedCategories filters which registry categories are exposed.
export function serializeAllowedSteps(allowedCategories = ["cleaning", "features"]) {
  const lines = ["ALLOWED PIPELINE STEPS (emit only these `type`s; provide every listed key):"];
  for (const s of STEP_REGISTRY) {
    if (s.internal) continue;
    if (!allowedCategories.includes(s.category)) continue;
    const keys = (s.schema || []).map(fieldHint).join(", ");
    lines.push(`- ${s.type} (${s.label}): ${s.description}`);
    if (keys) lines.push(`    keys: ${keys}`);
  }
  return lines.join("\n");
}
