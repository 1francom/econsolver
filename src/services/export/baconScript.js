// ─── ECON STUDIO · src/services/export/baconScript.js ─────────────────────────
// Replication snippets for the Goodman-Bacon (2021) decomposition.
//
// Single owner: both BaconPanel (under a TWFE result) and Explore's Plot Builder
// Bacon mode emit this. They used to be one copy inside BaconPanel; a second
// consumer is exactly how the three transpileStep copies drifted, so it lives
// here instead.
//
// The R branch names its frame `df_bacon` — Plot Builder's script preamble
// relies on that, since the geom is then built over it.

/**
 * @param {"r"|"python"|"stata"} lang
 * @param {{yCol:string, unitCol:string, timeCol:string, treatCol:string}} cols
 * @param {{withPlot?: boolean, dfVar?: string}} [opts]
 *   withPlot — append the ggplot weight-vs-estimate scatter (R only). Off when
 *              the caller draws the plot itself, as Plot Builder does.
 *   dfVar    — name of the input frame (default "df").
 */
export function baconScript(lang, { yCol, unitCol, timeCol, treatCol }, opts = {}) {
  const { withPlot = true, dfVar = "df" } = opts;
  if (lang === "r") {
    const out = [
      `# Goodman-Bacon decomposition — install.packages("bacondecomp")`,
      `library(bacondecomp)`,
      `df_bacon <- bacon(${yCol} ~ ${treatCol},`,
      `                  data = ${dfVar}, id_var = "${unitCol}", time_var = "${timeCol}")`,
      ``,
      `# Weighted sum reproduces the TWFE coefficient`,
      `sum(df_bacon$estimate * df_bacon$weight)`,
    ];
    if (withPlot) {
      out.push(
        ``,
        `# Weight vs estimate, by comparison type`,
        `library(ggplot2)`,
        `ggplot(df_bacon) +`,
        `  geom_point(aes(x = weight, y = estimate, colour = type, shape = type), size = 2) +`,
        `  geom_hline(yintercept = sum(df_bacon$estimate * df_bacon$weight), colour = "red") +`,
        `  labs(x = "Weight", y = "2x2 DD Estimate") + theme_minimal()`,
      );
    }
    return out.join("\n");
  }
  if (lang === "stata") {
    return [
      `* Goodman-Bacon decomposition — ssc install bacondecomp`,
      `xtset ${unitCol} ${timeCol}`,
      `bacondecomp ${yCol} ${treatCol}, ddetail`,
    ].join("\n");
  }
  return [
    `# No maintained Python port of bacondecomp exists as of this writing.`,
    `# Run the decomposition in R (bacondecomp::bacon) or Stata (bacondecomp),`,
    `# or compute the 2x2s and Goodman-Bacon (2021) weights directly:`,
    `#   weights depend only on group sizes and treated-period shares,`,
    `#   so they can be built from ${unitCol}/${timeCol}/${treatCol} alone.`,
  ].join("\n");
}
