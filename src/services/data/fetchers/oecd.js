// ─── ECON STUDIO · services/data/fetchers/oecd.js ────────────────────────────
// OECD Data API (SDMX-JSON) via server-side proxy (bypasses browser CORS).
// New API base: https://sdmx.oecd.org/public/rest
// Proxy adds: ?format=json&startPeriod=...&endPeriod=...&dimensionAtObservation=AllDimensions
//
// Dataset format: "{agency},{dataflow}" e.g. "OECD.SDD.NAD,DSD_NAAG@DF_NAAG_I"
// Key format: SDMX filter string, one value per dimension separated by dots.
//             Empty segment = wildcard (all values). Trailing dots optional.
//
// Exports:
//   POPULAR_OECD          — curated indicator list
//   fetchOECDIndicator(ind, opts?)   → Promise<{ rows, headers, meta }>

const PROXY_URL = "https://zxknjfezkatuldipdskw.supabase.co/functions/v1/oecd-proxy";

// ─── CURATED INDICATORS ───────────────────────────────────────────────────────
// Sources for dataflow IDs: https://data-explorer.oecd.org (Developer API icon)
// and https://db.nomics.world/OECD for dimension/key structures.
export const POPULAR_OECD = [
  // ── National Accounts (OECD.SDD.NAD, DSD_NAAG) ──
  // Dataflow DF_NAAG_I: FREQ . REF_AREA . MEASURE . UNIT_MEASURE . CHAPTER
  {
    id:      "GDP_PCAP_USD",
    dataset: "OECD.SDD.NAD,DSD_NAAG@DF_NAAG_I",
    key:     "A..B1GQ_POP.USD_PPP_PS.NAAG_I",
    name:    "GDP per capita, PPP (current international $)",
    group:   "National Accounts",
  },
  {
    id:      "GDP_GROWTH",
    dataset: "OECD.SDD.NAD,DSD_NAAG@DF_NAAG_I",
    key:     "A..B1GQ_R_GR.PC.NAAG_I",
    name:    "GDP growth rate (annual %)",
    group:   "National Accounts",
  },
  // DF_NAAG (full NAAG, 88 measures): FREQ . REF_AREA . MEASURE . UNIT_MEASURE . CHAPTER
  {
    id:      "GFCF_GDP",
    dataset: "OECD.SDD.NAD,DSD_NAAG@DF_NAAG",
    key:     "A..P51G.PC_GDP.",
    name:    "Gross fixed capital formation (% of GDP)",
    group:   "National Accounts",
  },
  // ── Labour & Productivity ──
  // DF_IALFS_INDIC: REF_AREA . MEASURE . UNIT_MEASURE . TRANSFORMATION . ADJUSTMENT . SEX . AGE . ACTIVITY . FREQ
  {
    id:      "EMPLOYMENT_RATE",
    dataset: "OECD.SDD.TPS,DSD_LFS@DF_IALFS_INDIC",
    key:     ".EMP_WAP.._Z.Y._T.Y15T64._Z.A",
    name:    "Employment rate, 15-64 (% working-age population)",
    group:   "Labour",
  },
  {
    id:      "UNEMPLOYMENT_RATE",
    dataset: "OECD.SDD.TPS,DSD_LFS@DF_IALFS_INDIC",
    key:     ".UNE_LF.._Z.Y._T.Y_GE15._Z.A",
    name:    "Unemployment rate (%, harmonised)",
    group:   "Labour",
  },
  // DF_PDB_LV: REF_AREA . FREQ . MEASURE . ACTIVITY . UNIT_MEASURE . PRICE_BASE . TRANSFORMATION . ADJUSTMENT . CONVERSION_TYPE
  {
    id:      "LABOUR_PRODUCTIVITY",
    dataset: "OECD.SDD.TPS,DSD_PDB@DF_PDB_LV",
    key:     ".A.GDPHRS._T.USD_PPP.Q._Z._Z._Z",
    name:    "Labour productivity per hour worked (USD PPP, constant prices)",
    group:   "Labour",
  },
  // ── Prices ──
  // DF_PRICES_ALL: REF_AREA . FREQ . METHODOLOGY . MEASURE . UNIT_MEASURE . EXPENDITURE . ADJUSTMENT . TRANSFORMATION
  {
    id:      "CPI_INFLATION",
    dataset: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL",
    key:     ".A.N.CPI.PA.CP00.N.GY",
    name:    "CPI inflation, all items (annual %)",
    group:   "Prices",
  },
  // ── Health (OECD.ELS.HD) ──
  // DF_SHA (System of Health Accounts): complex dimensions — key selects current health expenditure % GDP
  {
    id:      "HEALTH_EXPENDITURE",
    dataset: "OECD.ELS.HD,DSD_SHA@DF_SHA",
    key:     ".A.EXP_HEALTH.PC_GDP._T..HC1+HC2+HC3+HC4+HC5+HC6+HC7+HC9.._T...",
    name:    "Current health expenditure (% of GDP)",
    group:   "Health",
  },
  // DF_HEALTH_LVNG_AC: life expectancy and other health living conditions
  {
    id:      "LIFE_EXPECTANCY",
    dataset: "OECD.ELS.HD,DSD_HEALTH_LVNG@DF_HEALTH_LVNG_AC",
    key:     ".A.LE_B0...",
    name:    "Life expectancy at birth (years)",
    group:   "Health",
  },
  // ── FDI (OECD.DAF.INV) ──
  {
    id:      "FDI_INFLOWS",
    dataset: "OECD.DAF.INV,DSD_FDI@DF_FDI_FLOW_AGGR",
    key:     ".T_FA_F.USD.A.L..T.S1.W..._T.A.AGGR",
    name:    "FDI inflows (USD millions)",
    group:   "Trade",
  },
  // ── GHG Emissions (OECD.ENV.EPI) ──
  {
    id:      "CO2_PROD",
    dataset: "OECD.ENV.EPI,DSD_AIR_GHG@DF_AIR_GHG",
    key:     ".A.GHG.CAP.TOT.",
    name:    "GHG emissions per capita (tCO2-eq)",
    group:   "Environment",
  },
];

// Group labels for display
export const OECD_GROUPS = [...new Set(POPULAR_OECD.map(d => d.group))];

// ─── SDMX-JSON PARSER ────────────────────────────────────────────────────────
// Converts OECD SDMX-JSON response → flat rows: { country, iso2, year, [value] }
function parseSdmxJson(json, safeId) {
  const structure = json?.data?.structure ?? json?.structure;
  const dataSets  = json?.data?.dataSets  ?? json?.dataSets;

  if (!structure || !dataSets?.length) {
    throw new Error("Unexpected SDMX-JSON structure.");
  }

  const dims = structure.dimensions?.observation ?? [];
  // Find REF_AREA (country), TIME_PERIOD dimensions
  const areaIdx = dims.findIndex(d => d.id === "REF_AREA" || d.id === "COUNTRY" || d.id === "LOCATION");
  const timeIdx = dims.findIndex(d => d.id === "TIME_PERIOD" || d.id === "YEAR" || d.id === "TIME");
  if (areaIdx === -1 || timeIdx === -1) {
    throw new Error(`Could not find REF_AREA or TIME_PERIOD dimensions. Found: ${dims.map(d=>d.id).join(", ")}`);
  }

  const areaValues = dims[areaIdx].values;
  const timeValues = dims[timeIdx].values;

  const obs = dataSets[0].observations ?? {};
  const rows = [];

  for (const [key, obsArr] of Object.entries(obs)) {
    const indices = key.split(":").map(Number);
    const value   = obsArr?.[0];
    if (value == null || value === "" || !isFinite(Number(value))) continue;

    const area = areaValues[indices[areaIdx]];
    const time = timeValues[indices[timeIdx]];
    if (!area || !time) continue;

    const year = parseInt(time.id ?? time.name, 10);
    if (!isFinite(year)) continue;

    rows.push({
      country:  area.name ?? area.id,
      iso2:     area.id,
      year,
      [safeId]: Number(value),
    });
  }
  return rows;
}

// ─── FETCH ONE INDICATOR ─────────────────────────────────────────────────────
// opts: { countries: string[] (ISO2), startYear, endYear }
export async function fetchOECDIndicator(indicator, opts = {}) {
  const {
    countries = [],
    startYear = 2000,
    endYear   = 2023,
  } = opts;

  const { dataset, key, name, id } = indicator;
  const safeId = id;

  // Build country filter — OECD uses "+" separator
  // If empty, use "all" (returns all countries/regions, then we filter below)
  const countrySegment = countries.length > 0 ? countries.join("+") : "all";

  // Inject country filter into the key: keys are like "A.B1_GE.PPPPC.CPC.VLU.USD_PPP"
  // For OECD SDMX, country is usually the first or second segment — dataset-specific.
  // We fetch with country filter at the top-level path:
  // /data/{dataset}/{countryFilter}/{key}?format=json&startPeriod=...&endPeriod=...
  // But OECD API structure varies. Use simple approach: pass key as-is, filter post-fetch.
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset, key, startYear, endYear }),
  });

  if (!res.ok) throw new Error(`OECD proxy error ${res.status} for ${dataset}/${key}`);

  const json = await res.json();
  if (json.error) throw new Error(`OECD API error: ${json.error}`);

  let rows = parseSdmxJson(json, safeId);

  // Post-filter by country if requested
  if (countries.length > 0) {
    const set = new Set(countries.map(c => c.toUpperCase()));
    rows = rows.filter(r => set.has(r.iso2?.toUpperCase()));
  }

  return buildResult(rows, safeId, indicator, startYear, endYear);
}

function buildResult(rows, safeId, indicator, startYear, endYear) {
  if (!rows.length) {
    throw new Error(`No data returned for ${indicator.id}. The indicator key may have changed or data is unavailable for the selected period.`);
  }
  return {
    rows,
    headers: ["country", "iso2", "year", safeId],
    meta: {
      indicatorId:   indicator.id,
      indicatorName: indicator.name,
      dataset:       indicator.dataset,
      safeId,
      nObs:          rows.length,
      nCountries:    new Set(rows.map(r => r.iso2)).size,
      startYear,
      endYear,
      source:        "OECD Data",
    },
  };
}

// ─── FETCH MULTIPLE (wide join on iso2 + year) ────────────────────────────────
export async function fetchMultipleOECD(indicators, opts = {}) {
  const results = await Promise.allSettled(
    indicators.map(ind => fetchOECDIndicator(ind, opts))
  );

  const failed = results.filter(r => r.status === "rejected");
  if (failed.length === results.length) {
    throw new Error(failed[0]?.reason?.message ?? "All OECD indicator fetches failed.");
  }

  const map = {};
  const safeIds = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { rows, meta } = result.value;
    safeIds.push(meta.safeId);
    for (const r of rows) {
      const key = `${r.iso2}__${r.year}`;
      if (!map[key]) map[key] = { country: r.country, iso2: r.iso2, year: r.year };
      map[key][meta.safeId] = r[meta.safeId];
    }
  }

  const rows = Object.values(map);
  return {
    rows,
    headers: ["country", "iso2", "year", ...safeIds],
    meta: { nObs: rows.length, nCountries: new Set(rows.map(r => r.iso2)).size, source: "OECD Data" },
  };
}
