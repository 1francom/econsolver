#!/usr/bin/env node
// Focused gate for the recurring "X is not defined" runtime error class
// (e.g. `mono is not defined at draw (WorkbenchCanvas.jsx:86)`).
//
// These bugs only fault at render time, so Vite ships them silently and they
// resurface as stale-bundle whack-a-mole. ESLint's `no-undef` is the only tool
// that catches them at build time — but a full `eslint src` is buried under
// dozens of unrelated style errors (react-refresh, no-loss-of-precision, …),
// so it never gets run as a gate.
//
// This script runs the project's real ESLint flat config (full AST scope
// analysis, no fragile regex stripping) over `src/`, then reports ONLY the
// `no-undef` violations and exits non-zero if any exist. Wire it into the build
// (`"build": "node scripts/lint-undef.mjs && vite build"`) so no undefined
// identifier can ever deploy again.

import { ESLint } from "eslint";

const eslint = new ESLint();
const results = await eslint.lintFiles(["src"]);

const violations = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId === "no-undef") {
      violations.push(`${r.filePath}:${m.line}:${m.column}  ${m.message}`);
    }
  }
}

if (violations.length) {
  console.error(`\nFAIL — ${violations.length} undefined-identifier (no-undef) violation(s):\n`);
  for (const v of violations) console.error("  ✗ " + v);
  console.error(
    "\nEach of these throws `<name> is not defined` at runtime when its code path executes.\n" +
    "Fix: import/declare the identifier, thread it in as an argument, or delete the dead code.\n"
  );
  process.exit(1);
}

console.log(`ok — no undefined-identifier (no-undef) violations in src/ (${results.length} files scanned)`);
