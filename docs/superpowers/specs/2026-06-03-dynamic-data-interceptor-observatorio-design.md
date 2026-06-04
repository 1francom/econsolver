# Spec: Dynamic Data Interceptor + Observatorio Lucía Pérez Ingestion

**Date:** 2026-06-03
**Status:** OPEN
**Author:** Franco Medero

---

## Problem

Litux needs a repeatable way to ingest data that is served *dynamically* by
JavaScript front-ends (Flourish visualizations embedded in WordPress, etc.),
where the data is not in a static file but arrives over an XHR/fetch call
(commonly `admin-ajax.php`). The concrete driving case is the **femicide and
travesticide registry** published by the *Observatorio Lucía Pérez*, needed as a
balanced `(location, month, event_count)` panel for a Poisson panel / event-study
analysis.

A lot of Argentine government and NGO data sits behind this exact pattern, so the
discovery mechanism should be reusable, not one-off.

---

## Architectural constraint (non-negotiable)

Litux is a 100% client-side React/JS app. The only server surface is **thin Deno
edge functions** on Supabase (see `supabase/functions/oecd-proxy/index.ts`), which
forward an HTTP request and re-add CORS. **There is no Python in the app, and
nothing in the stack can host a headless browser.** Therefore Playwright cannot
live inside Litux.

Key insight: a Flourish chart fed by `admin-ajax.php` already receives its data
over a plain HTTP request returning JSON/CSV. Network interception is only needed
to **discover** that endpoint and its parameters *once*. After discovery, the
production fetch is an ordinary HTTP request replayable through the existing
proxy + JS-fetcher pattern. **The headless browser is a reverse-engineering tool,
not a runtime dependency.**

---

## Solution Overview

Two artifacts, separated by lifecycle. The boundary between them is a plain HTTP
**request spec** (URL + method + post-data + headers). Artifact A discovers it;
Artifact B replays it. Nothing in A is imported by the app; B never launches a
browser.

```
┌─ ARTIFACT A · DISCOVERY (dev machine, once per source) ────────────┐
│  tools/data-discovery/                                              │
│    interceptor.py    ← DynamicDataInterceptor (general, ~150 lines) │
│    observatorio.py   ← thin site adapter (Flourish/admin-ajax.php)  │
│    requirements.txt  ← playwright, pandas                           │
│    out/              ← raw payload dumps + manifest.json (gitignore)│
│  Output: confirmed endpoint spec + cleaned sample CSV               │
└─────────────────────────────────────────────────────────────────────┘
                         │ (endpoint spec copied by hand)
                         ▼
┌─ ARTIFACT B · IN-APP INGESTION (ships in Litux, no browser) ───────┐
│  supabase/functions/observatorio-proxy/index.ts ← thin CORS proxy  │
│  src/services/data/fetchers/observatorio.js     ← fetch+parse+PII   │
│  src/components/wrangling/ObservatorioFetcher.jsx ← Data-tab UI     │
│  Output: incident-level rows → existing pipeline builds the panel   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Artifact A — `tools/data-discovery/`

Isolated dev utility under `tools/`. Its own `requirements.txt`; ignored by the
Vite build; never imported by `src/`. `out/` is gitignored (may contain PII from
raw dumps).

### A.1 `interceptor.py` — general reusable core

```python
@dataclass
class Capture:
    url: str
    method: str
    request_post_data: str | None
    content_type: str
    status: int
    headers: dict[str, str]      # full response headers
    body_bytes: bytes

class DynamicDataInterceptor:
    def __init__(self, headless=True, timeout_ms=30000): ...

    def intercept(self, url, pattern, *, wait_for="networkidle") -> list[Capture]:
        # launch chromium → page.on("response", handler)
        # handler: if re.search(pattern, resp.url) and resp.ok and body non-empty
        #          → append Capture (including resp.headers)
        # page.goto(url, wait_until=wait_for) → return captures

    @staticmethod
    def dump(captures, out_dir):
        # write each body to out/NNN_<sanitized>.<ext>
        # write a single manifest.json: per-capture metadata incl. headers
```

Scope is deliberately minimal: regex/substring match against request URLs,
capture, dump. **No** JSONPath drilling, **no** trigger actions, **no** DataFrame
coupling — those would over-build a tool run a handful of times.

**Response headers are captured for every request** and written to
`manifest.json`. When `admin-ajax.php` fires several near-identical requests,
headers (`content-encoding`, `etag`, `content-length`, `x-wp-*`, session ids)
are the disambiguator that confirms which payload is the real registry without
diffing bodies.

### A.2 `observatorio.py` — thin site adapter

Holds *all* Observatorio/Flourish quirks (which capture is the registry, payload
nesting, Spanish column names). ~80 lines.

```python
URL     = "https://observatorioluciaperez.org/..."   # confirmed at discovery
PATTERN = r"admin-ajax\.php"

caps = DynamicDataInterceptor().intercept(URL, PATTERN)
DynamicDataInterceptor.dump(caps, "out/")   # for human inspection
df = to_dataframe(caps)                      # locate registry payload, json→DataFrame
df = clean(df)                               # fecha→ISO, select location+vinculo, DROP PII
df.to_csv("out/observatorio_clean.csv")
```

Fallback: if the data turns out to be embedded in the initial HTML / Flourish CDN
rather than a live `admin-ajax.php` XHR, the interceptor captures nothing matching
the pattern; widen the pattern (e.g. `flourish|admin-ajax|\.csv`) and re-run. The
truth is learned on first run.

This script also **confirms the endpoint spec** handed to Artifact B.

---

## Artifact B — in-app ingestion

### B.1 `supabase/functions/observatorio-proxy/index.ts`

Clone of `oecd-proxy` shape: CORS preamble, `OPTIONS` → 204, reads the request
descriptor from the POST body, forwards the confirmed `admin-ajax.php` request
upstream, guards non-JSON / upstream-error responses, returns the raw payload with
CORS re-added. Thin and dumb on purpose. Exists purely to dodge the cross-origin
block (`admin-ajax.php` will not send `Access-Control-Allow-Origin: *` to the
browser).

### B.2 `src/services/data/fetchers/observatorio.js`

Mirrors the `oecd.js` contract exactly:

```js
export async function fetchObservatorioRegistry(opts = {})
  → { rows, headers, meta }
```

- POSTs to the proxy, receives the Flourish/WP payload.
- `parseRegistry(payload)` → incident-level objects (one row per event).
- **PII strip at this boundary** (privacy-first invariant): whitelist only
  `fecha`, `provincia`, `comuna`, `barrio`, `vinculo`. Everything else
  (names, ages, free text) is dropped here and never enters Litux.
- **`fecha` normalization** to ISO `YYYY-MM-DD`. Coverage runs **1984→present**,
  so a `SPANISH_MONTHS` lookup handles the long form `"15 de mayo de 2024"`
  (accent-insensitive, lowercased; includes `setiembre`/`septiembre`), plus
  numeric `DD/MM/YYYY` and bare ISO. 4-digit years assumed (no `YY` pivot).
- **Unparseable dates are not silently dropped** — keep the row with
  `fecha: null`, preserve `_fecha_raw`, and report `nUnparsedDates` in `meta`.
  For a 40-year registry the bad rows must be visible, not lost from the panel.
- **Location fields returned as separate raw columns** — no fuzzy merging
  (respects the "comuna 1 ≠ comuna 2" rule; reconciliation is a pipeline choice).
- **`vinculo` returned as raw category** — normalization left to
  `recode` / `normalize_cats`.
- `meta`: `{ nObs, source: "Observatorio Lucía Pérez", fetchedAt,
  coverage: {minDate, maxDate}, nUnparsedDates, nDuplicatesDropped,
  nPotentialDuplicates }`.

### B.3 `src/components/wrangling/ObservatorioFetcher.jsx`

Follows `OECDFetcher.jsx` / `WorldBankFetcher.jsx`: button + status, optional
date-range inputs, on success hands `{rows, headers, meta}` to the same
dataset-load path as the other fetchers. Wired into the Data tab; styled with the
`C` constants. Contract-identical to the OECD/WB fetchers, so it slots into the
session-state registry with zero special-casing.

---

## Data flow — building the panel (uses existing pipeline only)

The fetcher stays thin; the balanced panel is built with steps that already ship,
so every aggregation choice stays replayable and auditable:

1. `fetch` → incident-level rows.
2. `date_extract` → month bucket (year-month) from `fecha`.
3. `group_summarize` → group by `(location, month)`, aggregate `count`.
4. `balance_panel` → `entityCol=location`, `timeCol=month`,
   `outcomeCols=[count]`, `fillValue=0` → complete location × month grid with
   **explicit zeros** for empty months (required for a Poisson event study).
   *(Already implemented — `runner.js:1334`, `registry.js:695`.)*
5. Estimate: Poisson FE (`runPoissonFEMulti`) or Sun-Abraham event study.

No new pipeline step is required; the earlier "panel gap" concern is already
covered by `balance_panel`.

---

## Error handling

- **Proxy:** non-JSON guard + upstream-status passthrough (per `oecd-proxy`).
- **Fetcher:** throws descriptive errors on schema drift (Flourish/WP can
  restructure the payload without notice) and on empty results — legible
  failures, not silent `undefined`.
- **Discovery tool:** timeout + "no captures matched pattern" still writes
  `manifest.json` so the pattern can be widened.

---

## Validation (per "validate before proceeding" convention)

- **Parse test:** a saved sample payload fixture → asserts incident count, the
  column whitelist (PII absent), and a few known dates across formats.
- **Source sanity check:** total incidents the fetcher returns for a given year
  must match the count the Observatorio publishes — the data-ingestion analogue
  of the R-validation discipline.
- Franco validates the live fetch + panel build in the browser before the source
  is considered done.

---

## Footnote: duplicate handling

The Observatorio may **update** entries (e.g. a case reclassified from
"tentativa" to "femicidio consumado"), which can resend a record. Dedup policy in
`parseRegistry`:

- If the payload exposes a stable **unique `id`**, dedup on it (default **on**,
  keep last) — safe.
- If no `id` exists, a `fecha + provincia + vinculo` **hash** dedup is available
  but **opt-in, off by default**. It is a two-sided heuristic:
  - it **misses** updates that edit one of the hashed fields (e.g. `vinculo`
    corrected), and
  - worse, it can **collapse two genuinely distinct femicides** sharing a
    date/province/vínculo into one, silently *undercounting* the panel.
- Either way, the fetcher reports `nDuplicatesDropped` (when on) and
  `nPotentialDuplicates` (hash collisions observed) in `meta`, so the decision is
  always visible. Default behavior never silently drops a distinct event.

---

## Out of scope

- Pagination, auth/session handling, scheduling in the discovery tool.
- Generalizing the in-app fetcher beyond the Observatorio (a second dynamic
  source would get its own thin proxy + fetcher, reusing this pattern).
- Location-name reconciliation across `provincia`/`comuna`/`barrio` — left to the
  user's wrangling pipeline.

---

## Ethics / sensitivity note

This is an extremely sensitive registry of gender-based killings, published for
public awareness and research. The design ingests **no PII** into the app (only
date, location, relationship-to-aggressor for counts), runs discovery
respectfully (single navigation, no hammering), and keeps any raw dump local to
the developer machine.
```

