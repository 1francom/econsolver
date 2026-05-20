// Validation harness for duckdbFactors.js
import { parseFactorSpec, expandFactors } from "../duckdbFactors.js";

let passes = 0, fails = 0;
const check = (n, c) => c ? (passes++, console.log(`  ✓ ${n}`)) : (fails++, console.error(`  ✗ ${n}`));

function validateParse() {
  console.log("\n[parseFactorSpec]");
  check("plain col → null", parseFactorSpec("x1") === null);
  check("factor(country) → 'country'", parseFactorSpec("factor(country)") === "country");
  check("whitespace tolerated", parseFactorSpec("factor( region )") === "region");
}

async function validateExpand() {
  console.log("\n[expandFactors]");
  const fakeLevels = async (col) => {
    if (col === "country") return ["DE", "FR", "IT"];
    if (col === "year")    return [2010, 2011, 2012];
    return [];
  };
  const out = await expandFactors({
    xCols: ["x1", "factor(country)", "x2"],
    fetchLevels: fakeLevels,
  });
  check("xColsExpanded length = 4", out.xColsExpanded.length === 4);
  check("reference level (DE) dropped", !out.xColsExpanded.includes("country_DE"));
  check("FR dummy present", out.xColsExpanded.includes("country_FR"));
  check("IT dummy present", out.xColsExpanded.includes("country_IT"));
  check("x1 before country dummies", out.xColsExpanded.indexOf("x1") < out.xColsExpanded.indexOf("country_FR"));
  check("x2 after country dummies", out.xColsExpanded.indexOf("x2") > out.xColsExpanded.indexOf("country_IT"));
  check("dummySQL FR has level literal", out.dummySQL.country_FR.includes("'FR'"));
  check("dummySQL uses CASE WHEN", out.dummySQL.country_FR.startsWith("CASE WHEN"));

  const out2 = await expandFactors({
    xCols: ["factor(year)"], fetchLevels: fakeLevels,
  });
  check("numeric levels unquoted in SQL", out2.dummySQL.year_2011.includes("= 2011"));
  check("numeric ref level (2010) dropped", !out2.xColsExpanded.includes("year_2010"));
}

export async function runFactorsValidation() {
  passes = 0; fails = 0;
  validateParse();
  await validateExpand();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
