// ─── ECON STUDIO · services/data/countryCodes.js ──────────────────────────────
// Country code / name / continent reference table + matcher. Analogous to R's
// `countrycode` package (`countrycode(x, "country.name", "iso3c" | "continent")`).
//
// UI-TIME ONLY. Nothing in runner.js, stepTranslators.js, or duckdbRunner.js
// imports this file — the `country_code` pipeline step resolves every distinct
// value ONCE in FeatureTab.jsx and freezes the result into a literal
// `step.map` before onAdd(), the same pattern normalize_cats/recode already
// use. The runner and every exporter then do a plain dictionary lookup; this
// table and its matching logic never run again at pipeline replay, at a
// project reload, or in an exported R/Python/Stata script. That isolation is
// deliberate — it is the same reasoning CLAUDE.md's PartialPlot/noIntercept
// entries document for "logic recomputed differently in two places".
//
// Spec: docs/superpowers/specs/2026-07-28-country-code-transform-design.md
// (v1 scope extended 2026-08-15 to add `continent` as a 4th destination,
// motivated by LMU PS4's `countrycode(data1$country, "country.name",
// "continent", warn = FALSE)`).
//
// Continent taxonomy: 5-way — Africa / Americas / Asia / Europe / Oceania —
// matching R's `countrycode(..., dest = "continent")` default exactly (no
// Antarctica, no North/South America split, Cyprus/Georgia/Armenia/
// Azerbaijan/Kazakhstan/Turkey classed Asia per the UN M49 geoscheme
// countrycode's table follows; Russia classed Europe).
//
// Universe: ISO 3166-1 sovereign states, plus the World-Bank-tracked
// non-sovereign economies Taiwan, Hong Kong SAR, Macao SAR and Kosovo — the
// same handful `worldBank.js#listCountries()` treats as separate economies.
// Deliberately NOT covering WB's smaller territories (Bermuda, Guam, Puerto
// Rico, Faroe Islands, French Polynesia, Channel Islands, …) — out of scope
// for v1; extend BASE below if a real dataset needs one.
//
// Exports:
//   COUNTRY_TABLE            — { iso2, iso3, name, continent, aliases }[]
//   matchCountry(rawValue)   — rawValue -> entry | null

// ─── BASE TABLE ────────────────────────────────────────────────────────────
// [iso2, iso3, name, continent]. Aliases live in ALIASES below, keyed by
// iso3 — kept separate so this list stays flat and auditable at a glance.
const BASE = [
  // Africa (54)
  ["DZ","DZA","Algeria","Africa"],
  ["AO","AGO","Angola","Africa"],
  ["BJ","BEN","Benin","Africa"],
  ["BW","BWA","Botswana","Africa"],
  ["BF","BFA","Burkina Faso","Africa"],
  ["BI","BDI","Burundi","Africa"],
  ["CV","CPV","Cabo Verde","Africa"],
  ["CM","CMR","Cameroon","Africa"],
  ["CF","CAF","Central African Republic","Africa"],
  ["TD","TCD","Chad","Africa"],
  ["KM","COM","Comoros","Africa"],
  ["CG","COG","Congo, Rep.","Africa"],
  ["CD","COD","Congo, Dem. Rep.","Africa"],
  ["DJ","DJI","Djibouti","Africa"],
  ["EG","EGY","Egypt","Africa"],
  ["GQ","GNQ","Equatorial Guinea","Africa"],
  ["ER","ERI","Eritrea","Africa"],
  ["SZ","SWZ","Eswatini","Africa"],
  ["ET","ETH","Ethiopia","Africa"],
  ["GA","GAB","Gabon","Africa"],
  ["GM","GMB","Gambia, The","Africa"],
  ["GH","GHA","Ghana","Africa"],
  ["GN","GIN","Guinea","Africa"],
  ["GW","GNB","Guinea-Bissau","Africa"],
  ["CI","CIV","Ivory Coast","Africa"],
  ["KE","KEN","Kenya","Africa"],
  ["LS","LSO","Lesotho","Africa"],
  ["LR","LBR","Liberia","Africa"],
  ["LY","LBY","Libya","Africa"],
  ["MG","MDG","Madagascar","Africa"],
  ["MW","MWI","Malawi","Africa"],
  ["ML","MLI","Mali","Africa"],
  ["MR","MRT","Mauritania","Africa"],
  ["MU","MUS","Mauritius","Africa"],
  ["MA","MAR","Morocco","Africa"],
  ["MZ","MOZ","Mozambique","Africa"],
  ["NA","NAM","Namibia","Africa"],
  ["NE","NER","Niger","Africa"],
  ["NG","NGA","Nigeria","Africa"],
  ["RW","RWA","Rwanda","Africa"],
  ["ST","STP","Sao Tome and Principe","Africa"],
  ["SN","SEN","Senegal","Africa"],
  ["SC","SYC","Seychelles","Africa"],
  ["SL","SLE","Sierra Leone","Africa"],
  ["SO","SOM","Somalia","Africa"],
  ["ZA","ZAF","South Africa","Africa"],
  ["SS","SSD","South Sudan","Africa"],
  ["SD","SDN","Sudan","Africa"],
  ["TZ","TZA","Tanzania","Africa"],
  ["TG","TGO","Togo","Africa"],
  ["TN","TUN","Tunisia","Africa"],
  ["UG","UGA","Uganda","Africa"],
  ["ZM","ZMB","Zambia","Africa"],
  ["ZW","ZWE","Zimbabwe","Africa"],

  // Americas (34)
  ["AG","ATG","Antigua and Barbuda","Americas"],
  ["AR","ARG","Argentina","Americas"],
  ["BS","BHS","Bahamas, The","Americas"],
  ["BB","BRB","Barbados","Americas"],
  ["BZ","BLZ","Belize","Americas"],
  ["BO","BOL","Bolivia","Americas"],
  ["BR","BRA","Brazil","Americas"],
  ["CA","CAN","Canada","Americas"],
  ["CL","CHL","Chile","Americas"],
  ["CO","COL","Colombia","Americas"],
  ["CR","CRI","Costa Rica","Americas"],
  ["CU","CUB","Cuba","Americas"],
  ["DM","DMA","Dominica","Americas"],
  ["DO","DOM","Dominican Republic","Americas"],
  ["EC","ECU","Ecuador","Americas"],
  ["SV","SLV","El Salvador","Americas"],
  ["GD","GRD","Grenada","Americas"],
  ["GT","GTM","Guatemala","Americas"],
  ["GY","GUY","Guyana","Americas"],
  ["HT","HTI","Haiti","Americas"],
  ["HN","HND","Honduras","Americas"],
  ["JM","JAM","Jamaica","Americas"],
  ["MX","MEX","Mexico","Americas"],
  ["NI","NIC","Nicaragua","Americas"],
  ["PA","PAN","Panama","Americas"],
  ["PY","PRY","Paraguay","Americas"],
  ["PE","PER","Peru","Americas"],
  ["KN","KNA","St. Kitts and Nevis","Americas"],
  ["LC","LCA","St. Lucia","Americas"],
  ["VC","VCT","St. Vincent and the Grenadines","Americas"],
  ["SR","SUR","Suriname","Americas"],
  ["TT","TTO","Trinidad and Tobago","Americas"],
  ["US","USA","United States","Americas"],
  ["UY","URY","Uruguay","Americas"],
  ["VE","VEN","Venezuela, RB","Americas"],

  // Asia (50, incl. Taiwan/Hong Kong SAR/Macao SAR)
  ["AF","AFG","Afghanistan","Asia"],
  ["AM","ARM","Armenia","Asia"],
  ["AZ","AZE","Azerbaijan","Asia"],
  ["BH","BHR","Bahrain","Asia"],
  ["BD","BGD","Bangladesh","Asia"],
  ["BT","BTN","Bhutan","Asia"],
  ["BN","BRN","Brunei Darussalam","Asia"],
  ["KH","KHM","Cambodia","Asia"],
  ["CN","CHN","China","Asia"],
  ["CY","CYP","Cyprus","Asia"],
  ["GE","GEO","Georgia","Asia"],
  ["IN","IND","India","Asia"],
  ["ID","IDN","Indonesia","Asia"],
  ["IR","IRN","Iran, Islamic Rep.","Asia"],
  ["IQ","IRQ","Iraq","Asia"],
  ["IL","ISR","Israel","Asia"],
  ["JP","JPN","Japan","Asia"],
  ["JO","JOR","Jordan","Asia"],
  ["KZ","KAZ","Kazakhstan","Asia"],
  ["KW","KWT","Kuwait","Asia"],
  ["KG","KGZ","Kyrgyz Republic","Asia"],
  ["LA","LAO","Lao PDR","Asia"],
  ["LB","LBN","Lebanon","Asia"],
  ["MY","MYS","Malaysia","Asia"],
  ["MV","MDV","Maldives","Asia"],
  ["MN","MNG","Mongolia","Asia"],
  ["MM","MMR","Myanmar","Asia"],
  ["NP","NPL","Nepal","Asia"],
  ["KP","PRK","Korea, Dem. People's Rep.","Asia"],
  ["OM","OMN","Oman","Asia"],
  ["PK","PAK","Pakistan","Asia"],
  ["PS","PSE","West Bank and Gaza","Asia"],
  ["PH","PHL","Philippines","Asia"],
  ["QA","QAT","Qatar","Asia"],
  ["SA","SAU","Saudi Arabia","Asia"],
  ["SG","SGP","Singapore","Asia"],
  ["KR","KOR","Korea, Rep.","Asia"],
  ["LK","LKA","Sri Lanka","Asia"],
  ["SY","SYR","Syrian Arab Republic","Asia"],
  ["TJ","TJK","Tajikistan","Asia"],
  ["TH","THA","Thailand","Asia"],
  ["TL","TLS","Timor-Leste","Asia"],
  ["TR","TUR","Turkiye","Asia"],
  ["TM","TKM","Turkmenistan","Asia"],
  ["AE","ARE","United Arab Emirates","Asia"],
  ["UZ","UZB","Uzbekistan","Asia"],
  ["VN","VNM","Vietnam","Asia"],
  ["YE","YEM","Yemen, Rep.","Asia"],
  ["TW","TWN","Taiwan","Asia"],
  ["HK","HKG","Hong Kong SAR, China","Asia"],
  ["MO","MAC","Macao SAR, China","Asia"],

  // Europe (44, incl. Kosovo)
  ["AL","ALB","Albania","Europe"],
  ["AD","AND","Andorra","Europe"],
  ["AT","AUT","Austria","Europe"],
  ["BY","BLR","Belarus","Europe"],
  ["BE","BEL","Belgium","Europe"],
  ["BA","BIH","Bosnia and Herzegovina","Europe"],
  ["BG","BGR","Bulgaria","Europe"],
  ["HR","HRV","Croatia","Europe"],
  ["CZ","CZE","Czechia","Europe"],
  ["DK","DNK","Denmark","Europe"],
  ["EE","EST","Estonia","Europe"],
  ["FI","FIN","Finland","Europe"],
  ["FR","FRA","France","Europe"],
  ["DE","DEU","Germany","Europe"],
  ["GR","GRC","Greece","Europe"],
  ["HU","HUN","Hungary","Europe"],
  ["IS","ISL","Iceland","Europe"],
  ["IE","IRL","Ireland","Europe"],
  ["IT","ITA","Italy","Europe"],
  ["XK","XKX","Kosovo","Europe"],
  ["LV","LVA","Latvia","Europe"],
  ["LI","LIE","Liechtenstein","Europe"],
  ["LT","LTU","Lithuania","Europe"],
  ["LU","LUX","Luxembourg","Europe"],
  ["MT","MLT","Malta","Europe"],
  ["MD","MDA","Moldova","Europe"],
  ["MC","MCO","Monaco","Europe"],
  ["ME","MNE","Montenegro","Europe"],
  ["NL","NLD","Netherlands","Europe"],
  ["MK","MKD","North Macedonia","Europe"],
  ["NO","NOR","Norway","Europe"],
  ["PL","POL","Poland","Europe"],
  ["PT","PRT","Portugal","Europe"],
  ["RO","ROU","Romania","Europe"],
  ["RU","RUS","Russian Federation","Europe"],
  ["SM","SMR","San Marino","Europe"],
  ["RS","SRB","Serbia","Europe"],
  ["SK","SVK","Slovak Republic","Europe"],
  ["SI","SVN","Slovenia","Europe"],
  ["ES","ESP","Spain","Europe"],
  ["SE","SWE","Sweden","Europe"],
  ["CH","CHE","Switzerland","Europe"],
  ["UA","UKR","Ukraine","Europe"],
  ["GB","GBR","United Kingdom","Europe"],
  ["VA","VAT","Vatican City","Europe"],

  // Oceania (14)
  ["AU","AUS","Australia","Oceania"],
  ["FJ","FJI","Fiji","Oceania"],
  ["KI","KIR","Kiribati","Oceania"],
  ["MH","MHL","Marshall Islands","Oceania"],
  ["FM","FSM","Micronesia, Fed. Sts.","Oceania"],
  ["NR","NRU","Nauru","Oceania"],
  ["NZ","NZL","New Zealand","Oceania"],
  ["PW","PLW","Palau","Oceania"],
  ["PG","PNG","Papua New Guinea","Oceania"],
  ["WS","WSM","Samoa","Oceania"],
  ["SB","SLB","Solomon Islands","Oceania"],
  ["TO","TON","Tonga","Oceania"],
  ["TV","TUV","Tuvalu","Oceania"],
  ["VU","VUT","Vanuatu","Oceania"],
];

// ─── ALIASES ────────────────────────────────────────────────────────────────
// Keyed by iso3. Covers: (a) the World Bank "Country Name" convention — the
// exact strings worldBank.js#fetchIndicator rows carry, and what a WDI-style
// CSV a student pastes in will use; (b) Our World in Data's naming, e.g. the
// "(country)" suffix OWID appends to disambiguate a real country from a
// same-named region aggregate (e.g. "Micronesia (country)" vs "Micronesia
// (region)"); (c) common English abbreviations; (d) historical/alternate
// names, and near-miss article variants (with/without "the"), still in
// circulation in real datasets. Case-insensitive at match time — do not add
// case variants here.
const ALIASES = {
  USA: ["USA", "US", "U.S.", "U.S.A.", "United States of America", "America"],
  GBR: ["UK", "U.K.", "Great Britain", "Britain", "England"],
  RUS: ["Russia"],
  KOR: ["South Korea", "Republic of Korea", "Korea South", "Korea, South"],
  PRK: ["North Korea", "Democratic People's Republic of Korea", "Korea North", "Korea, North"],
  COD: ["DR Congo", "DRC", "Congo-Kinshasa", "Democratic Republic of the Congo", "Democratic Republic of Congo", "Zaire"],
  COG: ["Congo", "Congo-Brazzaville", "Republic of the Congo"],
  CIV: ["Cote d'Ivoire", "Côte d'Ivoire", "Cote D'Ivoire"],
  SWZ: ["Swaziland"],
  MKD: ["Macedonia", "FYR Macedonia", "Macedonia, FYR"],
  CZE: ["Czech Republic"],
  MMR: ["Burma"],
  TLS: ["East Timor"],
  CPV: ["Cape Verde"],
  LAO: ["Laos", "Lao People's Democratic Republic"],
  SYR: ["Syria"],
  IRN: ["Iran", "Islamic Republic of Iran"],
  VEN: ["Venezuela", "Bolivarian Republic of Venezuela"],
  TZA: ["United Republic of Tanzania"],
  GMB: ["Gambia"],
  BHS: ["Bahamas"],
  FSM: ["Micronesia", "Federated States of Micronesia", "Micronesia (country)"],
  PSE: ["Palestine", "State of Palestine"],
  BRN: ["Brunei"],
  EGY: ["Egypt, Arab Rep."],
  YEM: ["Yemen"],
  KGZ: ["Kyrgyzstan"],
  SVK: ["Slovakia"],
  KNA: ["Saint Kitts and Nevis", "St Kitts and Nevis"],
  LCA: ["Saint Lucia", "St Lucia"],
  VCT: ["Saint Vincent and the Grenadines", "St Vincent and the Grenadines"],
  TUR: ["Turkey", "Türkiye"],
  VAT: ["Holy See", "Vatican"],
  HKG: ["Hong Kong"],
  MAC: ["Macao", "Macau"],
  TWN: ["Chinese Taipei"],
};

export const COUNTRY_TABLE = BASE.map(([iso2, iso3, name, continent]) => ({
  iso2, iso3, name, continent,
  aliases: ALIASES[iso3] || [],
}));

// ─── LOOKUP INDEX ───────────────────────────────────────────────────────────
// Built once at module load — matchCountry stays a case-fold + Map.get, never
// an O(n) scan of ~200 entries per call.
const BY_ISO2 = new Map();
const BY_ISO3 = new Map();
const BY_NAME = new Map(); // lowercased name/alias -> entry

for (const entry of COUNTRY_TABLE) {
  BY_ISO2.set(entry.iso2.toUpperCase(), entry);
  BY_ISO3.set(entry.iso3.toUpperCase(), entry);
  BY_NAME.set(entry.name.toLowerCase(), entry);
  for (const a of entry.aliases) BY_NAME.set(a.toLowerCase(), entry);
}

/**
 * Resolve a raw country identifier — name, ISO2, ISO3, or a known alias —
 * to its reference entry. Case-insensitive, trims whitespace. Exact match
 * only, no fuzzy/Levenshtein distance: per the spec, a wrong silent match on
 * country data (e.g. two different small nations one edit apart) is worse
 * than an unmatched null the UI surfaces before Apply.
 * @param {*} rawValue
 * @returns {{iso2:string, iso3:string, name:string, continent:string, aliases:string[]}|null}
 */
export function matchCountry(rawValue) {
  if (rawValue == null) return null;
  const v = String(rawValue).trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (v.length === 2 && BY_ISO2.has(upper)) return BY_ISO2.get(upper);
  if (v.length === 3 && BY_ISO3.has(upper)) return BY_ISO3.get(upper);
  return BY_NAME.get(v.toLowerCase()) || null;
}
