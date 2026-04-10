---
name: Add Data Source
description: Add a new external data source fetcher (API or file parser) to EconSolver. Use this skill when adding a new data API (IMF, Eurostat, UN, FRED, etc.), a new file format parser, or extending existing fetchers like World Bank or OECD.
---

## Add Data Source — EconSolver

### Architecture
Data sources live in `services/data/`:
```
services/data/
├── fetchers/
│   ├── worldBank.js   ← canonical pattern for API fetchers
│   ├── oecd.js
│   └── [new].js       ← add here
└── parsers/
    ├── csv.js
    ├── excel.js        ← SheetJS CDN pattern
    ├── stata.js        ← dynamic import pattern
    └── [new].js        ← add here for file formats
```
UI components in `components/wrangling/`:
- `WorldBankFetcher.jsx` — canonical pattern for fetcher modals.
- `OECDFetcher.jsx` — second reference.

### API fetcher contract (follow worldBank.js exactly)

**Required exports:**
```js
export const POPULAR_X = [{ id, name }]           // curated list for quick access
export async function searchX(query)               // → [{ id, name, note }]
export async function fetchX(indicatorId, opts)    // → { rows, headers, meta }
export async function fetchMultipleX(ids, opts)    // → { rows, headers, meta } (joined)
```

**Return shape — must match exactly:**
```js
{
  rows:    [{ country, iso3, year, [safeId]: value, ... }],
  headers: ["country", "iso3", "year", safeId, ...],
  meta: {
    indicatorId, indicatorName, safeId,
    nObs, nCountries, startYear, endYear, source
  }
}
```
`safeId` = indicatorId with dots replaced by underscores (e.g. `"NY.GDP.PCAP.KD"` → `"NY_GDP_PCAP_KD"`).

**Pagination pattern (from worldBank.js):**
```js
const totalPages = pageMeta?.pages ?? 1;
if (totalPages > 1) {
  const extras = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      fetch(`${url}&page=${i + 2}`).then(r => r.json()).then(([, data]) => data ?? [])
    )
  );
  allItems = allItems.concat(extras.flat());
}
```

### Wiring into DataStudio.jsx
1. Add import at top: `import NewFetcher from "./components/wrangling/NewFetcher.jsx"`.
2. Add state: `const [newOpen, setNewOpen] = useState(false)`.
3. Add button in `DatasetSidebar` (after OECD button):
```jsx
<button
  onClick={onFetchNew}
  style={{ width:"100%", marginTop:4, padding:"0.42rem 0.5rem", background:"transparent",
    border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer",
    fontFamily:mono, fontSize:10, transition:"all 0.12s" }}
  onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.color = C.gold; }}
  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
>↓ New Source data</button>
```
4. Pass `onFetchNew={() => setNewOpen(true)}` to `<DatasetSidebar>`.
5. Add modal at bottom of DataStudio return:
```jsx
{newOpen && (
  <NewFetcher
    onLoad={(fname, rows, headers) => handleSaveSubset(fname, rows, headers)}
    onClose={() => setNewOpen(false)}
  />
)}
```

### Fetcher modal pattern (from WorldBankFetcher.jsx)
- Props: `{ onLoad(filename, rows, headers), onClose }`.
- Internal flow: search → select indicator → select countries/years → fetch → call `onLoad`.
- Data lands in `DataStudio` via `handleSaveSubset` → appears in dataset sidebar → available for Merge tab JOIN/APPEND.
- Style with `C` from `DataStudio.jsx` (not from shared.jsx — DataStudio defines its own local C).

### File parser contract (follow excel.js pattern)
```js
// services/data/parsers/newFormat.js
export async function parseNewFormat(fileOrBuffer) {
  // Returns { headers: string[], rows: object[] } or null on failure
}
```
Wire into `DataStudio.jsx` `parseFile()` dispatcher:
```js
if (ext === "newext") {
  const { parseNewFormat } = await import("./services/data/parsers/newFormat.js");
  return parseNewFormat(file);
}
```
Use dynamic import (same pattern as stata.js) to avoid bundling large parsers upfront.

### Token efficiency
- Read `worldBank.js` as the template — it has pagination, multi-indicator join, and caching.
- Read `DataStudio.jsx` lines 165–350 for the sidebar UI pattern.
- Don't read `WranglingModule.jsx` — data sources plug into DataStudio, not wrangling.
- Target: ≤ 6 tool calls for a new API fetcher.
