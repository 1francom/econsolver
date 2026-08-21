// Validation harness for duckdbFactors.js
import { parseFactorSpec, expandFactors, sortLevels } from "../duckdbFactors.js";

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

  // Bug 2 regression: NULL factor rows must fall out via isfinite(), never
  // silently become the reference category (CASE WHEN ... ELSE 0 did that).
  check("dummySQL emits NULL (not 0) when factor is NULL",
    /IS NULL THEN NULL/.test(out.dummySQL.country_FR));

  // Custom reference category (2026-08-16 feature).
  const outRef = await expandFactors({
    xCols: ["factor(country)"], fetchLevels: fakeLevels, factorRefs: { country: "FR" },
  });
  check("custom ref (FR) dropped instead of the default (DE)",
    !outRef.xColsExpanded.includes("country_FR") && outRef.xColsExpanded.includes("country_DE"));
  check("the other levels are still both present",
    outRef.xColsExpanded.includes("country_DE") && outRef.xColsExpanded.includes("country_IT"));

  // Numeric column, custom ref given as a string (as the UI always sends it).
  const outRefNum = await expandFactors({
    xCols: ["factor(year)"], fetchLevels: fakeLevels, factorRefs: { year: "2011" },
  });
  check("custom ref on a numeric factor matches via string compare",
    !outRefNum.xColsExpanded.includes("year_2011") && outRefNum.xColsExpanded.includes("year_2010"));

  // A reference that isn't an actual level of the column must fall back to
  // the default (first sorted level) silently, not throw or drop everything.
  const outRefMiss = await expandFactors({
    xCols: ["factor(country)"], fetchLevels: fakeLevels, factorRefs: { country: "ES" },
  });
  check("unknown ref falls back to the default reference (DE dropped)",
    !outRefMiss.xColsExpanded.includes("country_DE") && outRefMiss.xColsExpanded.includes("country_FR"));
}

function validateSortLevels() {
  console.log("\n[sortLevels]");
  check("numeric levels sort ascending, not lexicographic",
    JSON.stringify(sortLevels([10, 11, 9])) === JSON.stringify([9, 10, 11]));
  check("string numeric-looking levels stay lexicographic (matches R factor() on character)",
    JSON.stringify(sortLevels(["9", "10", "11"])) === JSON.stringify(["10", "11", "9"]));
  check("string levels sort lexicographically",
    JSON.stringify(sortLevels(["banana", "apple", "cherry"])) === JSON.stringify(["apple", "banana", "cherry"]));
}

export async function runFactorsValidation() {
  passes = 0; fails = 0;
  validateParse();
  await validateExpand();
  validateSortLevels();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
