// ─── ECON STUDIO · services/data/fetchers/worldBank.js ───────────────────────
// World Bank Open Data API v2 — no API key required.
// Docs: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
//
// Exports:
//   searchIndicators(query)                → Promise<Indicator[]>
//   fetchIndicator(indicatorId, opts?)     → Promise<{ rows, headers, meta }>
//   listCountries()                        → Promise<Country[]>
//   POPULAR_INDICATORS                     — curated list for quick access

const BASE = "https://api.worldbank.org/v2";

// ─── POPULAR INDICATORS (curated for economics research) ─────────────────────
export const POPULAR_INDICATORS = [
  // Growth & income
  { id: "NY.GDP.PCAP.KD",    name: "GDP per capita (constant 2015 USD)" },
  { id: "NY.GDP.MKTP.KD.ZG", name: "GDP growth (annual %)" },
  { id: "NY.GDP.MKTP.KD",    name: "GDP (constant 2015 USD)" },
  { id: "NE.EXP.GNFS.ZS",    name: "Exports of goods & services (% of GDP)" },
  { id: "NE.IMP.GNFS.ZS",    name: "Imports of goods & services (% of GDP)" },
  // Poverty & inequality
  { id: "SI.POV.NAHC",       name: "Poverty headcount ratio (national, %)" },
  { id: "SI.POV.DDAY",       name: "Poverty headcount ratio $2.15/day (%)" },
  { id: "SI.DST.FRST.20",    name: "Income share held by lowest 20%" },
  { id: "SI.POV.GINI",       name: "Gini index" },
  // Labor
  { id: "SL.UEM.TOTL.ZS",    name: "Unemployment, total (% of labor force)" },
  { id: "SL.TLF.CACT.FE.ZS", name: "Labor force participation, female (%)" },
  { id: "SL.TLF.TOTL.IN",    name: "Labor force, total" },
  // Health
  { id: "SP.DYN.LE00.IN",    name: "Life expectancy at birth (years)" },
  { id: "SH.DYN.MORT",       name: "Mortality rate, under-5 (per 1,000)" },
  { id: "SH.XPD.CHEX.GD.ZS", name: "Current health expenditure (% of GDP)" },
  // Education
  { id: "SE.XPD.TOTL.GD.ZS", name: "Government expenditure on education (% of GDP)" },
  { id: "SE.ADT.LITR.ZS",    name: "Literacy rate, adult total (%)" },
  // Finance & macro
  { id: "FP.CPI.TOTL.ZG",    name: "Inflation, consumer prices (annual %)" },
  { id: "GC.DOD.TOTL.GD.ZS", name: "Central government debt (% of GDP)" },
  { id: "BX.KLT.DINV.WD.GD.ZS", name: "Foreign direct investment, net inflows (% of GDP)" },
  // Environment
  { id: "EN.ATM.CO2E.PC",    name: "CO₂ emissions (metric tons per capita)" },
  { id: "EG.USE.PCAP.KG.OE", name: "Energy use (kg of oil equivalent per capita)" },
  { id: "AG.LND.FRST.ZS",    name: "Forest area (% of land area)" },
  // Infrastructure
  { id: "IT.NET.USER.ZS",    name: "Individuals using the Internet (% of population)" },
  { id: "EG.ELC.ACCS.ZS",    name: "Access to electricity (% of population)" },
];

// ─── SEARCH INDICATORS ───────────────────────────────────────────────────────
// Returns up to 50 matching indicators from WB catalog.
export async function searchIndicators(query) {
  if (!query?.trim()) return POPULAR_INDICATORS;
  const q = encodeURIComponent(query.trim());
  const url = `${BASE}/indicator?format=json&per_page=50&q=${q}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank API error: ${res.status}`);
  const [meta, items] = await res.json();
  if (!Array.isArray(items)) return [];
  return items.map(ind => ({
    id:   ind.id,
    name: ind.name,
    note: ind.sourceNote?.slice(0, 120) ?? "",
  }));
}

// ─── LIST COUNTRIES ───────────────────────────────────────────────────────────
// Returns all country/region entries.
let _countriesCache = null;
export async function listCountries() {
  if (_countriesCache) return _countriesCache;
  const url = `${BASE}/country?format=json&per_page=300`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank API error: ${res.status}`);
  const [, items] = await res.json();
  _countriesCache = (items ?? [])
    .filter(c => c.region?.id !== "NA")   // exclude aggregates-only entries
    .map(c => ({
      iso3:   c.id,
      name:   c.name,
      region: c.region?.value ?? "",
      income: c.incomeLevel?.value ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return _countriesCache;
}

// ─── FETCH INDICATOR DATA ────────────────────────────────────────────────────
// opts: { countries: string[] (ISO3 codes, [] = all), startYear, endYear }
// Returns { rows: object[], headers: string[], meta: { indicatorId, indicatorName, nObs, nCountries } }
export async function fetchIndicator(indicatorId, opts = {}) {
  const {
    countries  = [],   // [] = all countries
    startYear  = 2000,
    endYear    = 2023,
  } = opts;

  const countryFilter = countries.length > 0
    ? countries.join(";")
    : "all";

  const perPage = 1000;
  const url = `${BASE}/country/${countryFilter}/indicator/${indicatorId}?format=json&per_page=${perPage}&mrv=${endYear - startYear + 1}&date=${startYear}:${endYear}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank API error: ${res.status} for indicator ${indicatorId}`);
  const payload = await res.json();
  if (!Array.isArray(payload) || payload.length < 2) {
    throw new Error("Unexpected World Bank response format.");
  }
  const [pageMeta, items] = payload;

  // If paginated (> 1000 obs), fetch remaining pages
  let allItems = items ?? [];
  const totalPages = pageMeta?.pages ?? 1;
  if (totalPages > 1) {
    const extras = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        fetch(`${url}&page=${i + 2}`)
          .then(r => r.json())
          .then(([, data]) => data ?? [])
      )
    );
    allItems = allItems.concat(extras.flat());
  }

  // ── Parse into rows ─────────────────────────────────────────────────────────
  const safeId = indicatorId.replace(/\./g, "_");   // "NY.GDP.PCAP.KD" → "NY_GDP_PCAP_KD"
  const rows = allItems
    .filter(obs => obs.value !== null && obs.value !== undefined && obs.value !== "")
    .map(obs => ({
      country:     obs.country?.value ?? obs.countryiso3code ?? "",
      iso3:        obs.countryiso3code ?? "",
      year:        parseInt(obs.date, 10),
      [safeId]:    typeof obs.value === "string" ? parseFloat(obs.value) : obs.value,
    }))
    .filter(r => isFinite(r.year) && isFinite(r[safeId]));

  if (!rows.length) {
    throw new Error(`No data returned for ${indicatorId}. Try a different date range or country selection.`);
  }

  const headers = ["country", "iso3", "year", safeId];
  const indicatorName = allItems[0]?.indicator?.value ?? indicatorId;
  const nCountries = new Set(rows.map(r => r.iso3)).size;

  return {
    rows,
    headers,
    meta: {
      indicatorId,
      indicatorName,
      safeId,
      nObs:      rows.length,
      nCountries,
      startYear,
      endYear,
      source:    "World Bank Open Data",
    },
  };
}

// ─── FETCH MULTIPLE INDICATORS (panel join) ───────────────────────────────────
// Fetches N indicators and joins on (iso3, year).
// Returns a wide dataset: { rows, headers, meta }
export async function fetchMultipleIndicators(indicatorIds, opts = {}) {
  const results = await Promise.all(
    indicatorIds.map(id => fetchIndicator(id, opts))
  );

  // Build a map: iso3+year → row
  const map = {};
  const allSafeIds = [];

  for (const { rows, meta } of results) {
    allSafeIds.push(meta.safeId);
    for (const r of rows) {
      const key = `${r.iso3}__${r.year}`;
      if (!map[key]) map[key] = { country: r.country, iso3: r.iso3, year: r.year };
      map[key][meta.safeId] = r[meta.safeId];
    }
  }

  const rows = Object.values(map);
  const headers = ["country", "iso3", "year", ...allSafeIds];
  return {
    rows,
    headers,
    meta: {
      indicatorIds,
      nObs:     rows.length,
      nCountries: new Set(rows.map(r => r.iso3)).size,
      source:   "World Bank Open Data",
    },
  };
}
