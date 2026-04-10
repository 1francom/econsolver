// ─── ECON STUDIO · services/data/fetchers/oecd.js ────────────────────────────
// OECD Data API (SDMX-JSON v2) — no API key required, CORS enabled.
// Docs: https://sdmx.oecd.org/public/rest/
//
// Exports:
//   POPULAR_OECD          — curated indicator list
//   fetchOECDIndicator(ind, opts?)   → Promise<{ rows, headers, meta }>
//
// SDMX-JSON response structure:
//   data.dataSets[0].observations: { "i:j:k": [value, status] }
//   Keys are colon-separated indices into dimension value arrays.
//   data.structure.dimensions.observation[d].values[i] gives the label.

const BASE = "https://sdmx.oecd.org/public/rest";

// ─── CURATED INDICATORS ───────────────────────────────────────────────────────
// Each entry: { id, dataset, key, name, freqFilter?, measureCol }
// key uses OECD filter syntax: "ALL" or "A+Q+M" for freq, country filter, etc.
export const POPULAR_OECD = [
  // ── National Accounts ──
  {
    id:      "GDP_PCAP_USD",
    dataset: "na_main",
    key:     "A.B1_GE.PPPPC.CPC.VLU.USD_PPP",
    name:    "GDP per capita, PPP (current international $)",
    group:   "National Accounts",
  },
  {
    id:      "GDP_GROWTH",
    dataset: "na_main",
    key:     "A.B1_GE.PPPPC.CPC.GRW.PA",
    name:    "GDP growth rate (annual %)",
    group:   "National Accounts",
  },
  {
    id:      "GFCF_GDP",
    dataset: "na_main",
    key:     "A.P51.PPPPC.CPC.SHR.PA",
    name:    "Gross fixed capital formation (% of GDP)",
    group:   "National Accounts",
  },
  // ── Labour & Productivity ──
  {
    id:      "EMPLOYMENT_RATE",
    dataset: "lfs_sexage_i_r",
    key:     "A.EMPRATE.MW.1564.T",
    name:    "Employment rate, 15–64 (% working-age population)",
    group:   "Labour",
  },
  {
    id:      "UNEMPLOYMENT_RATE",
    dataset: "lfs_sexage_i_r",
    key:     "A.UNEMPRATE.MW.T.T",
    name:    "Unemployment rate (%, harmonised)",
    group:   "Labour",
  },
  {
    id:      "LABOUR_PRODUCTIVITY",
    dataset: "pdbi_p4",
    key:     "A.T_GDPHRS.PPPGDP.OECD2015",
    name:    "Labour productivity per hour worked (USD PPP, 2015 = 100)",
    group:   "Labour",
  },
  // ── Government ──
  {
    id:      "GOV_REVENUE_GDP",
    dataset: "rev",
    key:     "A.TOT.TRS.TAXREV_GDPRATIO",
    name:    "General government revenue (% of GDP)",
    group:   "Government",
  },
  {
    id:      "GOV_DEBT_GDP",
    dataset: "gov_10dd_edpt1",
    key:     "A.S13.GD.FY0.PC_GDP",
    name:    "Government gross debt (% of GDP, Maastricht)",
    group:   "Government",
  },
  {
    id:      "GOV_SPENDING_EDU",
    dataset: "eag_finance_indicators",
    key:     "A.TOT.ED0T8.INSTEX.AS.INS_GOVTOTAL",
    name:    "Public expenditure on education (% of GDP)",
    group:   "Government",
  },
  // ── Trade ──
  {
    id:      "EXPORTS_GDP",
    dataset: "na_main",
    key:     "A.P6.PPPPC.CPC.SHR.PA",
    name:    "Exports of goods & services (% of GDP)",
    group:   "Trade",
  },
  {
    id:      "FDI_INFLOWS",
    dataset: "fdi_main",
    key:     "A.INFLOWS.T_GDPRATIO",
    name:    "FDI inflows (% of GDP)",
    group:   "Trade",
  },
  // ── Prices & Finance ──
  {
    id:      "CPI_INFLATION",
    dataset: "prices_cpi",
    key:     "A.CPI.TOT.ANR",
    name:    "CPI inflation (annual rate %)",
    group:   "Prices",
  },
  {
    id:      "INTEREST_RATE_LT",
    dataset: "mei_fin",
    key:     "A.IRLT.STE.T",
    name:    "Long-term interest rate (10-year government bonds, %)",
    group:   "Finance",
  },
  // ── Health ──
  {
    id:      "HEALTH_EXPENDITURE",
    dataset: "health_stat",
    key:     "A.HEXP.TOTAL.PC_GDP",
    name:    "Health expenditure (% of GDP)",
    group:   "Health",
  },
  {
    id:      "LIFE_EXPECTANCY",
    dataset: "health_stat",
    key:     "A.LIFEEXP.TOTAL.YRS",
    name:    "Life expectancy at birth (years)",
    group:   "Health",
  },
  // ── Education ──
  {
    id:      "PISA_MATH",
    dataset: "pisa_2022_s",
    key:     "A.MAT.MEAN.T",
    name:    "PISA mean score — Mathematics",
    group:   "Education",
  },
  // ── Environment ──
  {
    id:      "CO2_PROD",
    dataset: "air_ghg",
    key:     "A.GHG.TOT.PC",
    name:    "GHG emissions per capita (tCO₂-eq)",
    group:   "Environment",
  },
  {
    id:      "RENEWABLE_ENERGY",
    dataset: "tsdcc310",
    key:     "A.PC_RENEW.TOT",
    name:    "Renewable energy share in total final consumption (%)",
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
  const url = [
    `${BASE}/data/${dataset}/${key}`,
    `?format=json`,
    `&startPeriod=${startYear}`,
    `&endPeriod=${endYear}`,
    countries.length > 0 ? `&dimensionAtObservation=AllDimensions` : "",
  ].join("");

  const res = await fetch(url, { headers: { Accept: "application/vnd.sdmx.data+json" } });
  if (!res.ok) {
    // Try alternative URL format with country filter embedded
    const altUrl = `${BASE}/data/${dataset}/${countrySegment}/${key}?format=json&startPeriod=${startYear}&endPeriod=${endYear}`;
    const altRes = await fetch(altUrl, { headers: { Accept: "application/vnd.sdmx.data+json" } });
    if (!altRes.ok) throw new Error(`OECD API error ${altRes.status} for ${dataset}/${key}`);
    const json = await altRes.json();
    const rows = parseSdmxJson(json, safeId);
    return buildResult(rows, safeId, indicator, startYear, endYear);
  }
  const json = await res.json();
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
