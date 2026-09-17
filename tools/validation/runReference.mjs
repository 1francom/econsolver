// ─── ECON STUDIO · tools/validation/runReference.mjs ─────────────────────────
// Runs an ORIGINAL reference script (an LMU tutorial solution) and dumps every
// model it leaves behind as JSON, so the harness can compare Litux and the
// scripts Litux emits against the numbers the course itself publishes.
//
//   node tools/validation/runReference.mjs <unit>
//   node tools/validation/runReference.mjs --all
//
// Nothing in the reference script is edited: it is `source()`d from a wrapper
// that (1) points the working directory at the data, since the scripts carry
// their author's own `setwd()`, and (2) afterwards walks the global environment
// and extracts coefficients, standard errors and N from every fitted object it
// recognises. That keeps the reference honest — we compare against what the
// script actually produced, not a transcription of it.
//
// Inputs and outputs live under validation/, which is git-ignored (the course
// material is not ours to publish).

import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const RSCRIPT = process.env.RSCRIPT_EXE ?? "C:/Program Files/R/R-4.4.1/bin/Rscript.exe";
const ROOT    = path.resolve(import.meta.dirname, "../..");
const VAL     = path.join(ROOT, "validation");
const TUT     = path.join(VAL, "LMU-tutorials");
const DATA    = path.join(TUT, "tutorials");
const OUT     = path.join(VAL, "results");

// One entry per validation unit (see docs/superpowers/plans/2026-09-17-real-data-validation.md).
export const UNITS = {
  PS2:  { script: path.join(TUT, "PS2_sol_code.R"),            cwd: DATA },
  PS3:  { script: path.join(TUT, "PS3_sol_code.R"),            cwd: DATA },
  PS4:  { script: path.join(TUT, "PS4_sol_code.R"),            cwd: DATA },
  PS5:  { script: path.join(TUT, "PS5_code_solutions (1).R"),  cwd: DATA },
  PS6:  { script: path.join(TUT, "PS6_Ex2_staggered (2).R"),   cwd: DATA },
  LM6:  { script: path.join(TUT, "Replication Scripts/Tutorial_6_labor_market_min_wage.R"), cwd: DATA },
};

const rStr = (s) => `"${s.replace(/\\/g, "/").replace(/"/g, '\\"')}"`;

// The wrapper. `setwd` is overridden for the duration of the source() call
// because every script sets its author's own path; everything else runs as
// written. Extraction is per class, since each package stores its SEs
// differently — and a class we do not know is REPORTED, never silently skipped.
function wrapper(script, cwd, outFile) {
  return `
options(warn = 1, repos = c(CRAN = "https://cloud.r-project.org"))
setwd(${rStr(cwd)})
# Overrides live on the SEARCH PATH, not in globalenv: several scripts open with
# rm(list = ls()), which would wipe them from globalenv and hand the script
# base::setwd again (PS5 then died on the author own Dropbox path).
#   setwd()           - the scripts set their own author's directory
#   install.packages() - PS5/PS6 install from inside the script; everything they
#                        need is already installed, and a source build here
#                        would silently change the versions under test
attach(list(
  setwd = function(dir) invisible(getwd()),
  install.packages = function(pkgs, ...) invisible(message("[litux] install.packages(", paste(pkgs, collapse = ", "), ") suppressed"))
), name = "litux_overrides", warn.conflicts = FALSE)
.litux_err <- NULL
tryCatch(
  source(${rStr(script)}, echo = FALSE, max.deparse.length = Inf),
  error = function(e) .litux_err <<- conditionMessage(e)
)
detach("litux_overrides")

.litux_num <- function(x) if (is.null(x)) NULL else as.numeric(x)
.litux_entry <- function(nm, obj) {
  cls <- class(obj)
  co <- NULL; se <- NULL; nms <- NULL; n <- NA
  if (inherits(obj, "rdrobust")) {
    # rdrobust: three rows (Conventional / Bias-Corrected / Robust)
    nms <- rownames(obj$coef); co <- as.numeric(obj$coef[, 1]); se <- as.numeric(obj$se[, 1])
    n <- sum(obj$N_h)
  } else if (inherits(obj, "fixest")) {
    s <- summary(obj); co <- as.numeric(s$coeftable[, 1]); se <- as.numeric(s$coeftable[, 2])
    nms <- rownames(s$coeftable); n <- tryCatch(nobs(obj), error = function(e) NA)
  } else if (inherits(obj, "lm_robust") || inherits(obj, "iv_robust")) {
    co <- as.numeric(obj$coefficients); se <- as.numeric(obj$std.error)
    nms <- names(obj$coefficients); n <- obj$nobs
  } else if (inherits(obj, "lm") || inherits(obj, "glm") || inherits(obj, "ivreg")) {
    s <- summary(obj); co <- as.numeric(s$coefficients[, 1]); se <- as.numeric(s$coefficients[, 2])
    nms <- rownames(s$coefficients); n <- tryCatch(nobs(obj), error = function(e) NA)
  } else if (inherits(obj, "MP")) {              # did::att_gt
    co <- as.numeric(obj$att); se <- as.numeric(obj$se)
    nms <- paste0("g", obj$group, "_t", obj$t); n <- obj$n
  } else if (inherits(obj, "AGGTEobj")) {        # did::aggte
    co <- c(overall = as.numeric(obj$overall.att), as.numeric(obj$att.egt))
    se <- c(as.numeric(obj$overall.se), as.numeric(obj$se.egt))
    nms <- c("overall", if (!is.null(obj$egt)) paste0("e", obj$egt) else NULL)
  } else if (inherits(obj, "bacon") || (is.data.frame(obj) && all(c("type", "weight", "estimate") %in% names(obj)))) {
    co <- as.numeric(obj$estimate); se <- as.numeric(obj$weight)   # weight travels in the se slot
    nms <- paste(obj$type, obj$treated, obj$untreated, sep = "|")
  } else if (inherits(obj, "synth.output") || inherits(obj, "list") && !is.null(obj$solution.w)) {
    co <- as.numeric(obj$solution.w); nms <- rownames(obj$solution.w); se <- rep(NA_real_, length(co))
  } else {
    return(NULL)
  }
  list(name = nm, class = cls, terms = nms, coef = .litux_num(co), se = .litux_num(se), n = n)
}

.litux_out <- list(); .litux_unknown <- character()
for (.nm in ls(envir = globalenv())) {
  if (startsWith(.nm, ".litux")) next
  .obj <- tryCatch(get(.nm, envir = globalenv()), error = function(e) NULL)
  if (is.null(.obj) || is.function(.obj)) next
  .e <- tryCatch(.litux_entry(.nm, .obj), error = function(e) NULL)
  if (!is.null(.e)) .litux_out[[.nm]] <- .e
  else if (inherits(.obj, c("rdrobust", "fixest", "lm", "glm", "MP", "AGGTEobj")))
    .litux_unknown <- c(.litux_unknown, paste(.nm, class(.obj)[1]))
}
writeLines(jsonlite::toJSON(list(
  error = if (is.null(.litux_err)) NULL else .litux_err,
  unknown = .litux_unknown,
  models = unname(.litux_out)
), auto_unbox = TRUE, digits = NA, null = "null"), ${rStr(outFile)})
`;
}

export function runReference(unit) {
  const cfg = UNITS[unit];
  if (!cfg) throw new Error(`Unknown unit "${unit}". Known: ${Object.keys(UNITS).join(", ")}`);
  if (!existsSync(cfg.script)) return { unit, skipped: `missing script ${path.basename(cfg.script)}` };
  mkdirSync(OUT, { recursive: true });
  const outFile = path.join(OUT, `${unit}.reference.json`);
  const wrapFile = path.join(OUT, `_${unit}.wrapper.R`);
  rmSync(outFile, { force: true });
  writeFileSync(wrapFile, wrapper(cfg.script, cfg.cwd, outFile));

  let stderr = "";
  try {
    execFileSync(RSCRIPT, [wrapFile], { cwd: cfg.cwd, stdio: ["ignore", "ignore", "pipe"], timeout: 30 * 60 * 1000 });
  } catch (e) { stderr = String(e.stderr ?? e.message ?? "").slice(-4000); }

  if (!existsSync(outFile)) return { unit, failed: stderr || "the wrapper produced no output" };
  const res = JSON.parse(readFileSync(outFile, "utf8"));
  return {
    unit,
    file: outFile,
    error: res.error ?? null,
    unknown: res.unknown ?? [],
    models: (res.models ?? []).length,
    stderrTail: res.error ? stderr.slice(-800) : "",
  };
}

if (import.meta.filename === process.argv[1]) {
  const arg = process.argv[2];
  const units = !arg || arg === "--all" ? Object.keys(UNITS) : [arg];
  for (const u of units) {
    const r = runReference(u);
    if (r.skipped) console.log(`skip  ${u}: ${r.skipped}`);
    else if (r.failed) console.log(`FAIL  ${u}: ${r.failed.split("\n").slice(-3).join(" | ")}`);
    else console.log(`ok    ${u}: ${r.models} models${r.error ? ` (script error: ${r.error})` : ""}`
      + (r.unknown.length ? `  [unextracted: ${r.unknown.join(", ")}]` : ""));
  }
}
