# Dynamic Data Interceptor + Observatorio Ingestion — Implementation Plan

> **⚑ ARCHITECTURE PIVOT (2026-06-04).** Discovery confirmed the registry is
> served by WordPress `admin-ajax.php` (`action=padron_femicidios_ajax_data`,
> DataTables positional rows, `recordsTotal: 5321`), but the site sits behind
> **Imunify360 bot-protection** — both Playwright capture and any server-side
> proxy (datacenter IP) are blocked by design. We deliberately did **not** build
> evasion. The live-fetch path (`fetchObservatorioRegistry` + `observatorio-proxy`
> edge function) is therefore **dropped**; both were removed from the codebase.
> Replacement: the user pulls the raw JSON from their own authenticated browser
> session (console snippet), and `ObservatorioFetcher.jsx` imports it via paste /
> file upload → `parseRegistryText` → `parseRegistry`. The parser was rewritten
> for the **positional** schema (col 0 `id|nombre` split + name dropped, col 8
> fiscal dropped, col 9 link dropped; whitelist = fecha/provincia/partido/
> localidad/vinculo/edad/hijxs). Tasks 7–8 and Phase 5 below are superseded by
> this note where they describe the proxy/live fetch.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Python+Playwright discovery tool that intercepts dynamic XHR/fetch payloads, then ship a permanent in-app Litux data source that ingests the Observatorio Lucía Pérez femicide/travesticide registry as incident-level rows ready to be turned into a balanced Poisson panel.

**Architecture:** Two lifecycle-separated artifacts. **(A)** `tools/data-discovery/` — a standalone Python utility (`DynamicDataInterceptor`) that runs once on the dev machine to discover the `admin-ajax.php` endpoint and dump sample payloads. **(B)** in-app ingestion mirroring the existing `oecd.js` pattern: a thin Deno proxy (`observatorio-proxy`) + a pure-JS fetcher (`observatorio.js`, PII-strip + Spanish-date parse + dedup) + a modal UI (`ObservatorioFetcher.jsx`). The boundary between A and B is a plain HTTP request spec. B never launches a browser. The balanced panel is built entirely with existing pipeline steps (`date_extract → group_summarize → balance_panel`).

**Tech Stack:** Python 3.11 + Playwright + pandas (Artifact A, isolated, not part of the Vite build); JavaScript ES modules + Node built-in `node --test` runner (Artifact B fetcher + tests); Deno (Supabase edge function); React 19 + inline styles via `useTheme()` `C` constants (UI).

**Reference spec:** `docs/superpowers/specs/2026-06-03-dynamic-data-interceptor-observatorio-design.md`

---

## File Structure

**Artifact A — discovery tool (new, isolated):**
- Create `tools/data-discovery/interceptor.py` — general `DynamicDataInterceptor` class + `Capture` dataclass.
- Create `tools/data-discovery/observatorio.py` — thin site adapter (Flourish/`admin-ajax.php` specifics → cleaned CSV).
- Create `tools/data-discovery/requirements.txt` — `playwright`, `pandas`.
- Create `tools/data-discovery/tests/test_interceptor.py` — pytest unit tests for the pure logic.
- Create `tools/data-discovery/README.md` — how to install + run.
- Modify `.gitignore` — ignore `tools/data-discovery/out/`.

**Artifact B — in-app ingestion (new + wiring):**
- Create `src/services/data/fetchers/observatorio.js` — fetcher + pure helpers (`normalizeFecha`, `applyWhitelist`, `dedupeIncidents`, `parseRegistry`, `fetchObservatorioRegistry`).
- Create `src/services/data/fetchers/observatorio.test.js` — Node `--test` unit tests.
- Create `src/services/data/fetchers/__fixtures__/observatorio_sample.json` — synthetic payload in the real top-level shape (NO real PII).
- Create `supabase/functions/observatorio-proxy/index.ts` — thin CORS proxy.
- Create `src/components/wrangling/ObservatorioFetcher.jsx` — modal UI.
- Modify `src/App.jsx` — import, `obsOpen` state, trigger menu entry, modal mount.

**Dependency note:** Phase 2 (pure JS helpers) is structure-agnostic and can be built immediately. Phase 3's `parseRegistry` field mapping has a sensible default but must be **confirmed against the real payload** produced by Phase 1's live run (see Task 4 checkpoint).

---

## Phase 1 — Artifact A: the discovery tool

### Task 1: Scaffold the isolated Python tool

**Files:**
- Create: `tools/data-discovery/requirements.txt`
- Create: `tools/data-discovery/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Create `requirements.txt`**

```
playwright==1.48.0
pandas==2.2.3
```

- [ ] **Step 2: Create `README.md`**

````markdown
# data-discovery

One-off discovery tool for dynamic (XHR/fetch-served) datasets. NOT part of the
Litux build — pure dev utility. See
`docs/superpowers/specs/2026-06-03-dynamic-data-interceptor-observatorio-design.md`.

## Install
```bash
cd tools/data-discovery
python -m venv .venv && . .venv/Scripts/activate   # Windows bash
pip install -r requirements.txt
python -m playwright install chromium
```

## Run discovery for the Observatorio
```bash
python observatorio.py
# → out/manifest.json, out/NNN_*.json, out/observatorio_clean.csv
```

## Run tests
```bash
pytest tests/ -v
```

`out/` is gitignored — raw dumps may contain PII and must stay local.
````

- [ ] **Step 3: Add `out/` to `.gitignore`**

Append to `C:\Franco\econsolver\.gitignore`:

```
# data-discovery raw dumps (may contain PII)
tools/data-discovery/out/
```

- [ ] **Step 4: Verify the directory exists and is ignored**

Run: `cd tools/data-discovery && mkdir -p out && touch out/probe && git check-ignore out/probe`
Expected: prints `out/probe` (confirming it is ignored), then `rm out/probe`.

- [ ] **Step 5: Commit**

```bash
git add tools/data-discovery/requirements.txt tools/data-discovery/README.md .gitignore
git commit -m "chore(discovery): scaffold isolated data-discovery python tool"
```

---

### Task 2: `DynamicDataInterceptor` — pure logic (TDD)

The pure, browser-free parts: URL matching, extension inference, and `dump()` (writing bodies + a `manifest.json` that includes response headers). These are unit-tested without Playwright.

**Files:**
- Create: `tools/data-discovery/interceptor.py`
- Test: `tools/data-discovery/tests/test_interceptor.py`

- [ ] **Step 1: Write the failing tests**

Create `tools/data-discovery/tests/test_interceptor.py`:

```python
import json
from pathlib import Path
from interceptor import DynamicDataInterceptor, Capture


def test_matches_substring_and_regex():
    assert DynamicDataInterceptor._matches("https://x/wp-admin/admin-ajax.php?a=1", r"admin-ajax\.php")
    assert DynamicDataInterceptor._matches("https://x/data/feed.json", r"\.json")
    assert not DynamicDataInterceptor._matches("https://x/style.css", r"admin-ajax\.php")


def test_ext_for_content_type():
    assert DynamicDataInterceptor._ext_for("application/json; charset=utf-8") == "json"
    assert DynamicDataInterceptor._ext_for("text/csv") == "csv"
    assert DynamicDataInterceptor._ext_for("application/octet-stream") == "bin"


def test_dump_writes_bodies_and_manifest_with_headers(tmp_path):
    caps = [
        Capture(
            url="https://x/admin-ajax.php?action=get_data",
            method="POST",
            request_post_data="action=get_data",
            content_type="application/json",
            status=200,
            headers={"content-encoding": "gzip", "etag": "W/\"abc\""},
            body_bytes=b'{"ok":true}',
        )
    ]
    DynamicDataInterceptor.dump(caps, tmp_path)

    body_files = sorted(p.name for p in tmp_path.glob("0*.json"))
    assert len(body_files) == 1
    assert (tmp_path / body_files[0]).read_bytes() == b'{"ok":true}'

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest[0]["url"].endswith("action=get_data")
    assert manifest[0]["status"] == 200
    assert manifest[0]["headers"]["etag"] == 'W/"abc"'   # headers captured
    assert manifest[0]["request_post_data"] == "action=get_data"
    assert "body_bytes" not in manifest[0]               # bytes not serialized
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools/data-discovery && pytest tests/ -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'interceptor'`.

- [ ] **Step 3: Write `interceptor.py`**

Create `tools/data-discovery/interceptor.py`:

```python
"""DynamicDataInterceptor — capture XHR/fetch payloads matching a URL pattern.

General, reusable discovery tool. Match-by-regex, capture, dump. No JSONPath,
no trigger actions, no DataFrame coupling — site quirks live in adapters.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path


_EXT_BY_TYPE = {
    "json": "json",
    "csv": "csv",
    "javascript": "js",
    "html": "html",
    "xml": "xml",
}


@dataclass
class Capture:
    url: str
    method: str
    request_post_data: str | None
    content_type: str
    status: int
    headers: dict          # full response headers (disambiguates near-identical reqs)
    body_bytes: bytes


class DynamicDataInterceptor:
    def __init__(self, headless: bool = True, timeout_ms: int = 30000):
        self.headless = headless
        self.timeout_ms = timeout_ms

    # ── pure helpers (unit-tested) ────────────────────────────────────────
    @staticmethod
    def _matches(url: str, pattern: str) -> bool:
        return re.search(pattern, url) is not None

    @staticmethod
    def _ext_for(content_type: str) -> str:
        ct = (content_type or "").lower()
        for key, ext in _EXT_BY_TYPE.items():
            if key in ct:
                return ext
        return "bin"

    @staticmethod
    def dump(captures: list[Capture], out_dir) -> None:
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        manifest = []
        for i, c in enumerate(captures):
            ext = DynamicDataInterceptor._ext_for(c.content_type)
            safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", c.url.split("?")[0])[-60:]
            fname = f"{i:03d}_{safe}.{ext}"
            (out / fname).write_bytes(c.body_bytes)
            row = asdict(c)
            row.pop("body_bytes", None)
            row["file"] = fname
            manifest.append(row)
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))

    # ── live capture (manual smoke test; not unit-tested) ─────────────────
    def intercept(self, url: str, pattern: str, *, wait_for: str = "networkidle") -> list[Capture]:
        from playwright.sync_api import sync_playwright

        captures: list[Capture] = []
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()

            def on_response(resp):
                try:
                    if not self._matches(resp.url, pattern):
                        return
                    if not resp.ok:
                        return
                    body = resp.body()
                    if not body:
                        return
                    req = resp.request
                    captures.append(Capture(
                        url=resp.url,
                        method=req.method,
                        request_post_data=req.post_data,
                        content_type=resp.headers.get("content-type", ""),
                        status=resp.status,
                        headers=dict(resp.headers),
                        body_bytes=body,
                    ))
                except Exception:
                    pass  # never let a handler crash the navigation

            page.on("response", on_response)
            page.goto(url, wait_until=wait_for, timeout=self.timeout_ms)
            browser.close()
        return captures
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/data-discovery && pytest tests/ -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/data-discovery/interceptor.py tools/data-discovery/tests/test_interceptor.py
git commit -m "feat(discovery): DynamicDataInterceptor with header-aware capture + dump"
```

---

### Task 3: Observatorio site adapter

**Files:**
- Create: `tools/data-discovery/observatorio.py`

- [ ] **Step 1: Write the adapter**

Create `tools/data-discovery/observatorio.py`:

```python
"""Observatorio Lucía Pérez adapter — Flourish/admin-ajax.php discovery.

Quarantines ALL site-specific quirks. Run this to confirm the endpoint spec
that Litux's in-app fetcher (src/services/data/fetchers/observatorio.js) replays.
"""
import json
from pathlib import Path

import pandas as pd

from interceptor import DynamicDataInterceptor

# Confirmed during discovery — update if the site moves the embed.
URL = "https://observatorioluciaperez.org/"
PATTERN = r"admin-ajax\.php|flourish|\.csv"   # wide net; narrow after first run

OUT = Path(__file__).parent / "out"

# Analytical whitelist — everything else is PII and is dropped.
KEEP = ["fecha", "provincia", "comuna", "barrio", "vinculo"]


def to_dataframe(captures) -> pd.DataFrame:
    """Locate the registry payload among captures and load to a DataFrame.

    Strategy: pick the largest JSON body that parses to a list of records (or a
    dict with a list under a 'data'/'rows'/'value' key). Print candidates so a
    human can confirm against manifest.json.
    """
    best, best_len = None, -1
    for c in captures:
        if "json" not in c.content_type.lower():
            continue
        try:
            payload = json.loads(c.body_bytes)
        except Exception:
            continue
        records = _records_from(payload)
        if records is not None and len(records) > best_len:
            best, best_len = records, len(records)
    if best is None:
        raise SystemExit("No JSON list payload found. Inspect out/manifest.json and widen PATTERN.")
    return pd.DataFrame(best)


def _records_from(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("data", "rows", "value", "records"):
            if isinstance(payload.get(k), list):
                return payload[k]
    return None


def clean(df: pd.DataFrame) -> pd.DataFrame:
    cols = [c for c in KEEP if c in df.columns]
    print("Columns present:", list(df.columns))
    print("Kept (whitelist):", cols)
    return df[cols].copy() if cols else df


def main():
    caps = DynamicDataInterceptor(headless=True).intercept(URL, PATTERN)
    DynamicDataInterceptor.dump(caps, OUT)
    print(f"Captured {len(caps)} responses → {OUT}/manifest.json")
    df = to_dataframe(caps)
    df = clean(df)
    out_csv = OUT / "observatorio_clean.csv"
    df.to_csv(out_csv, index=False)
    print(f"Wrote {len(df)} rows → {out_csv}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add tools/data-discovery/observatorio.py
git commit -m "feat(discovery): Observatorio Flourish/admin-ajax adapter"
```

---

### Task 4: ⚑ CHECKPOINT — run discovery against the live site (manual, Franco)

This is a **manual** step that cannot be automated (needs a real browser + network) and it produces the ground truth the rest of the plan depends on.

- [ ] **Step 1: Run discovery**

Run: `cd tools/data-discovery && python observatorio.py`

- [ ] **Step 2: Confirm the endpoint spec**

Open `out/manifest.json`. Identify which capture is the real registry (use response headers — `content-length`, `etag`, `x-wp-*` — to disambiguate if several `admin-ajax.php` requests fired). Record, for Phase 3/4:
- the exact request **URL**,
- the **method** (likely POST),
- the **`request_post_data`** (the `action=...` body `admin-ajax.php` needs),
- the **top-level JSON shape** (list vs `{data:[...]}`) and the **real key names** for date / province / comuna / barrio / vínculo.

- [ ] **Step 3: Verify the count vs the published source**

Compare `len(observatorio_clean.csv)` against the femicide total the Observatorio reports for the covered period. They should match (sanity check).

- [ ] **Step 4: Record findings**

Append a short "## Discovery results" section to `tools/data-discovery/README.md` with the endpoint spec + real key names from Step 2. Commit:

```bash
git add tools/data-discovery/README.md
git commit -m "docs(discovery): record Observatorio endpoint spec + payload shape"
```

> If the real key names differ from the defaults assumed in Phase 3 (`FIELD_MAP`), update `FIELD_MAP` and the synthetic fixture in Task 6/7 to match before finishing Phase 3.

---

## Phase 2 — Artifact B: pure JS helpers (structure-agnostic, TDD)

These three helpers depend on no payload shape and can be built immediately. JS tests use Node's built-in runner (`node --test`, no new dependency; the repo is ESM).

### Task 5: Spanish-date normalizer + PII whitelist + dedup (TDD)

**Files:**
- Create: `src/services/data/fetchers/observatorio.js`
- Test: `src/services/data/fetchers/observatorio.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/services/data/fetchers/observatorio.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFecha, applyWhitelist, dedupeIncidents } from "./observatorio.js";

test("normalizeFecha — Spanish long form", () => {
  assert.equal(normalizeFecha("15 de mayo de 2024"), "2024-05-15");
  assert.equal(normalizeFecha("3 de enero de 1984"), "1984-01-03");
  assert.equal(normalizeFecha("9 de setiembre de 2001"), "2001-09-09"); // setiembre
});

test("normalizeFecha — numeric and ISO", () => {
  assert.equal(normalizeFecha("15/05/2024"), "2024-05-15");
  assert.equal(normalizeFecha("2024-05-15"), "2024-05-15");
});

test("normalizeFecha — accent + case insensitive", () => {
  assert.equal(normalizeFecha("15 de Mayo de 2024"), "2024-05-15");
  assert.equal(normalizeFecha("15 de DICIEMBRE de 2024"), "2024-12-15");
});

test("normalizeFecha — unparseable returns null", () => {
  assert.equal(normalizeFecha("sin fecha"), null);
  assert.equal(normalizeFecha(""), null);
  assert.equal(normalizeFecha(null), null);
});

test("applyWhitelist keeps only allowed keys", () => {
  const row = { fecha: "x", provincia: "y", nombre: "Victim Name", edad: 30 };
  const out = applyWhitelist(row, ["fecha", "provincia", "comuna", "barrio", "vinculo"]);
  assert.deepEqual(Object.keys(out).sort(), ["fecha", "provincia"]);
  assert.equal("nombre" in out, false); // PII dropped
});

test("dedupeIncidents — id-based default on", () => {
  const rows = [{ id: 1, fecha: "a" }, { id: 1, fecha: "a2" }, { id: 2, fecha: "b" }];
  const r = dedupeIncidents(rows, { idKey: "id" });
  assert.equal(r.rows.length, 2);
  assert.equal(r.nDuplicatesDropped, 1);
});

test("dedupeIncidents — hash OFF by default, only reports collisions", () => {
  const rows = [
    { fecha: "2024-05-15", provincia: "BA", vinculo: "pareja" },
    { fecha: "2024-05-15", provincia: "BA", vinculo: "pareja" }, // distinct event, same key
  ];
  const r = dedupeIncidents(rows, { hashKeys: ["fecha", "provincia", "vinculo"] });
  assert.equal(r.rows.length, 2);              // nothing dropped
  assert.equal(r.nPotentialDuplicates, 1);     // collision surfaced
});

test("dedupeIncidents — hash opt-in drops collisions", () => {
  const rows = [
    { fecha: "2024-05-15", provincia: "BA", vinculo: "pareja" },
    { fecha: "2024-05-15", provincia: "BA", vinculo: "pareja" },
  ];
  const r = dedupeIncidents(rows, { hashKeys: ["fecha", "provincia", "vinculo"], useHash: true });
  assert.equal(r.rows.length, 1);
  assert.equal(r.nDuplicatesDropped, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/services/data/fetchers/observatorio.test.js`
Expected: FAIL — `Cannot find module './observatorio.js'` / exports undefined.

- [ ] **Step 3: Write the helpers**

Create `src/services/data/fetchers/observatorio.js` (helpers only for now; `parseRegistry`/`fetchObservatorioRegistry` are added in Task 7):

```js
// ─── ECON STUDIO · services/data/fetchers/observatorio.js ────────────────────
// Observatorio Lucía Pérez femicide/travesticide registry.
// Data arrives via admin-ajax.php (discovered with tools/data-discovery).
// Privacy-first: only analytical columns ever enter Litux (PII stripped here).

const PROXY_URL = "https://zxknjfezkatuldipdskw.supabase.co/functions/v1/observatorio-proxy";

// Spanish month names → number. Accent-stripped, lowercased before lookup.
// Includes both "setiembre" and "septiembre" spellings.
const SPANISH_MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, setiembre: 9, septiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

const stripAccents = s =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const pad2 = n => String(n).padStart(2, "0");

// Coverage is 1984→present; assume 4-digit years (no YY pivot).
export function normalizeFecha(raw) {
  if (raw == null) return null;
  const s = stripAccents(String(raw).trim().toLowerCase());
  if (!s) return null;

  // ISO: 2024-05-15
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  // Numeric: 15/05/2024 or 15-05-2024
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;

  // Long form: "15 de mayo de 2024"
  m = s.match(/^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})$/);
  if (m) {
    const month = SPANISH_MONTHS[m[2]];
    if (month) return `${m[3]}-${pad2(month)}-${pad2(m[1])}`;
  }
  return null;
}

// Keep only whitelisted keys — drops names/ages/free-text PII at the boundary.
export function applyWhitelist(row, allow) {
  const out = {};
  for (const k of allow) if (k in row) out[k] = row[k];
  return out;
}

// Dedup policy:
//   - idKey present  → dedup on id (keep last), default ON.
//   - hashKeys only  → collisions reported but NOT dropped unless useHash=true.
export function dedupeIncidents(rows, { idKey = null, hashKeys = null, useHash = false } = {}) {
  if (idKey && rows.some(r => r[idKey] != null)) {
    const byId = new Map();
    for (const r of rows) byId.set(r[idKey], r); // keep last
    return {
      rows: [...byId.values()],
      nDuplicatesDropped: rows.length - byId.size,
      nPotentialDuplicates: 0,
    };
  }
  if (hashKeys && hashKeys.length) {
    const seen = new Map();
    const kept = [];
    let collisions = 0;
    for (const r of rows) {
      const key = hashKeys.map(k => String(r[k] ?? "")).join("\u0001");
      if (seen.has(key)) {
        collisions++;
        if (useHash) continue; // drop only when explicitly opted in
      } else {
        seen.set(key, true);
      }
      kept.push(r);
    }
    return {
      rows: kept,
      nDuplicatesDropped: useHash ? collisions : 0,
      nPotentialDuplicates: useHash ? 0 : collisions,
    };
  }
  return { rows, nDuplicatesDropped: 0, nPotentialDuplicates: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/services/data/fetchers/observatorio.test.js`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/data/fetchers/observatorio.js src/services/data/fetchers/observatorio.test.js
git commit -m "feat(fetcher): Spanish-date/PII-whitelist/dedup helpers for Observatorio"
```

---

## Phase 3 — Artifact B: parseRegistry + fetcher

### Task 6: Synthetic fixture (real shape, no PII)

The fixture mirrors the **top-level shape discovered in Task 4** but uses fabricated rows so no real victim PII enters the repo. If Task 4 found the payload is `{data:[...]}` rather than a bare list, adjust the wrapper accordingly.

**Files:**
- Create: `src/services/data/fetchers/__fixtures__/observatorio_sample.json`

- [ ] **Step 1: Create the fixture**

```json
{
  "data": [
    { "id": 1, "fecha": "15 de mayo de 2024", "provincia": "Buenos Aires", "comuna": "La Plata", "barrio": "Centro", "vinculo": "pareja", "nombre": "FAKE NAME A", "edad": 31 },
    { "id": 2, "fecha": "03/01/1984", "provincia": "Córdoba", "comuna": "Capital", "barrio": "Alberdi", "vinculo": "ex pareja", "nombre": "FAKE NAME B", "edad": 24 },
    { "id": 3, "fecha": "2001-09-09", "provincia": "Santa Fe", "comuna": "Rosario", "barrio": "Centro", "vinculo": "familiar", "nombre": "FAKE NAME C", "edad": 45 },
    { "id": 4, "fecha": "sin dato", "provincia": "Mendoza", "comuna": "", "barrio": "", "vinculo": "desconocido", "nombre": "FAKE NAME D", "edad": null },
    { "id": 4, "fecha": "2001-09-09", "provincia": "Santa Fe", "comuna": "Rosario", "barrio": "Centro", "vinculo": "familiar", "nombre": "FAKE NAME C (update)", "edad": 45 }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/data/fetchers/__fixtures__/observatorio_sample.json
git commit -m "test(fetcher): synthetic Observatorio payload fixture (no PII)"
```

---

### Task 7: `parseRegistry` + `fetchObservatorioRegistry` (TDD)

**Files:**
- Modify: `src/services/data/fetchers/observatorio.js`
- Modify: `src/services/data/fetchers/observatorio.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `src/services/data/fetchers/observatorio.test.js`:

```js
import { parseRegistry } from "./observatorio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/observatorio_sample.json", import.meta.url)))
);

test("parseRegistry — strips PII, keeps whitelist, normalizes dates", () => {
  const { rows, headers, meta } = parseRegistry(fixture);
  // PII gone
  assert.equal(rows.every(r => !("nombre" in r) && !("edad" in r)), true);
  // whitelist headers only (+ _fecha_raw bookkeeping allowed)
  assert.deepEqual(headers, ["fecha", "provincia", "comuna", "barrio", "vinculo"]);
  // id-dedup default on: id:4 appears twice → one dropped
  assert.equal(meta.nDuplicatesDropped, 1);
  // dates normalized; the "sin dato" row keeps fecha:null + raw preserved
  const r1 = rows.find(r => r.provincia === "Buenos Aires");
  assert.equal(r1.fecha, "2024-05-15");
  const bad = rows.find(r => r.provincia === "Mendoza");
  assert.equal(bad.fecha, null);
  assert.equal(meta.nUnparsedDates, 1);
});

test("parseRegistry — meta coverage spans min/max parsed dates", () => {
  const { meta } = parseRegistry(fixture);
  assert.equal(meta.coverage.minDate, "1984-01-03");
  assert.equal(meta.coverage.maxDate, "2024-05-15");
  assert.equal(meta.source, "Observatorio Lucía Pérez");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/services/data/fetchers/observatorio.test.js`
Expected: FAIL — `parseRegistry` is not exported.

- [ ] **Step 3: Implement `parseRegistry` + `fetchObservatorioRegistry`**

Append to `src/services/data/fetchers/observatorio.js`:

```js
const WHITELIST = ["fecha", "provincia", "comuna", "barrio", "vinculo"];

// Map real payload keys → canonical names. Defaults assume Spanish keys; if
// discovery (Task 4) found different names, edit the right-hand sides here.
const FIELD_MAP = {
  id:        "id",
  fecha:     "fecha",
  provincia: "provincia",
  comuna:    "comuna",
  barrio:    "barrio",
  vinculo:   "vinculo",
};

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  for (const k of ["data", "rows", "value", "records"]) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  throw new Error("Observatorio payload has no recognizable record list (schema drift?).");
}

// Pure: payload → { rows, headers, meta }. Incident-level, PII-stripped.
export function parseRegistry(payload, { dedup = {} } = {}) {
  const raw = recordsFrom(payload);
  if (!raw.length) throw new Error("Observatorio payload contained zero records.");

  // 1. canonical-rename via FIELD_MAP
  const renamed = raw.map(r => {
    const o = {};
    for (const [canon, srcKey] of Object.entries(FIELD_MAP)) {
      if (srcKey in r) o[canon] = r[srcKey];
    }
    return o;
  });

  // 2. dedup (id default on; hash opt-in)
  const dd = dedupeIncidents(renamed, {
    idKey: "id",
    hashKeys: ["fecha", "provincia", "vinculo"],
    useHash: false,
    ...dedup,
  });

  // 3. normalize dates + strip PII to whitelist
  let nUnparsedDates = 0;
  let minDate = null, maxDate = null;
  const rows = dd.rows.map(r => {
    const iso = normalizeFecha(r.fecha);
    const out = applyWhitelist(r, WHITELIST);
    if (iso) {
      out.fecha = iso;
      if (!minDate || iso < minDate) minDate = iso;
      if (!maxDate || iso > maxDate) maxDate = iso;
    } else {
      out.fecha = null;
      out._fecha_raw = r.fecha ?? null;
      nUnparsedDates++;
    }
    return out;
  });

  return {
    rows,
    headers: WHITELIST,
    meta: {
      source: "Observatorio Lucía Pérez",
      nObs: rows.length,
      fetchedAt: new Date().toISOString(),
      coverage: { minDate, maxDate },
      nUnparsedDates,
      nDuplicatesDropped: dd.nDuplicatesDropped,
      nPotentialDuplicates: dd.nPotentialDuplicates,
    },
  };
}

// Live fetch: POST the discovered request descriptor to the proxy, then parse.
export async function fetchObservatorioRegistry(opts = {}) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Observatorio proxy error ${res.status}${body.detail ? ": " + String(body.detail).slice(0, 200) : ""}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(`Observatorio API error: ${json.error}`);
  return parseRegistry(json, opts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/services/data/fetchers/observatorio.test.js`
Expected: all tests pass (10 total).

- [ ] **Step 5: Commit**

```bash
git add src/services/data/fetchers/observatorio.js src/services/data/fetchers/observatorio.test.js
git commit -m "feat(fetcher): parseRegistry + fetchObservatorioRegistry (PII-strip, dedup, dates)"
```

---

## Phase 4 — Artifact B: the CORS proxy

### Task 8: `observatorio-proxy` edge function

Thin clone of `oecd-proxy`. No automated test (the repo has none for `oecd-proxy`); verified by deploy + curl.

**Files:**
- Create: `supabase/functions/observatorio-proxy/index.ts`

- [ ] **Step 1: Write the proxy**

Create `supabase/functions/observatorio-proxy/index.ts` (fill `UPSTREAM_URL` / `method` / `body` from the Task 4 endpoint spec):

```ts
// observatorio-proxy: server-side proxy for the Observatorio Lucía Pérez
// admin-ajax.php registry endpoint (bypasses browser CORS). Thin + dumb.

const UPSTREAM_URL = "https://observatorioluciaperez.org/wp-admin/admin-ajax.php"; // confirm via discovery

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    // Optional overrides from client; defaults come from the discovered spec.
    const { action = "get_data", postData = "" } = await req.json().catch(() => ({}));
    const body = postData || `action=${encodeURIComponent(action)}`;

    const res = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `Observatorio upstream ${res.status}`, detail: detail.slice(0, 500) }),
        { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ error: `Observatorio returned non-JSON (${ct})`, detail: text.slice(0, 500) }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy observatorio-proxy`
Expected: deploy succeeds; function URL printed.

- [ ] **Step 3: Verify with curl**

Run:
```bash
curl -s -X POST https://zxknjfezkatuldipdskw.supabase.co/functions/v1/observatorio-proxy \
  -H "Content-Type: application/json" -d '{}' | head -c 400
```
Expected: a JSON payload (the registry) or a structured `{error,detail}` — NOT an HTML error page.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/observatorio-proxy/index.ts
git commit -m "feat(proxy): observatorio-proxy edge function (CORS + non-JSON guard)"
```

---

## Phase 5 — Artifact B: the UI

### Task 9: `ObservatorioFetcher.jsx` modal

Follows `OECDFetcher.jsx`: `useTheme()` `C`, modal overlay, `onLoad(fname, rows, headers)` + `onClose()`. Surfaces `meta` (counts, unparsed dates, dedup) so the privacy/quality decisions are visible.

**Files:**
- Create: `src/components/wrangling/ObservatorioFetcher.jsx`

- [ ] **Step 1: Write the component**

```jsx
// ─── ECON STUDIO · components/wrangling/ObservatorioFetcher.jsx ──────────────
// Modal for fetching the Observatorio Lucía Pérez femicide/travesticide registry.
// Props: onLoad(filename, rows, headers), onClose()

import { useState, useEffect } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { fetchObservatorioRegistry } from "../../services/data/fetchers/observatorio.js";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

export default function ObservatorioFetcher({ onLoad, onClose }) {
  const { C } = useTheme();
  const [step, setStep]   = useState("ready");   // "ready" | "fetching" | "error"
  const [error, setError] = useState("");
  const [meta, setMeta]   = useState(null);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function handleFetch() {
    setStep("fetching");
    setError("");
    try {
      const { rows, headers, meta } = await fetchObservatorioRegistry();
      setMeta(meta);
      onLoad("observatorio_femicidios.csv", rows, headers);
      onClose();
    } catch (e) {
      setError(e.message ?? "Fetch failed.");
      setStep("error");
    }
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(0,0,0,0.82)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"min(560px,96vw)", background:C.surface, border:`1px solid ${C.border2}`, borderRadius:6, display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.7)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"0.75rem 1.1rem", background:C.bg, borderBottom:`1px solid ${C.border}` }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:C.textMuted, letterSpacing:"0.22em", textTransform:"uppercase", fontFamily:mono, marginBottom:2 }}>Registro · Femicidios / Travesticidios</div>
            <div style={{ fontSize:15, color:C.text, fontFamily:mono }}>Observatorio Lucía Pérez</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textMuted, cursor:"pointer", fontFamily:mono, fontSize:11, padding:"0.25rem 0.6rem" }}>✕ Close</button>
        </div>

        <div style={{ padding:"1rem 1.1rem", fontSize:11, color:C.textDim, fontFamily:mono, lineHeight:1.6 }}>
          Imports incident-level records (fecha · provincia · comuna · barrio · vínculo).
          Identifying fields are stripped before the data enters Litux.
          <div style={{ marginTop:8, color:C.textMuted, fontSize:10 }}>
            Build a panel: <span style={{ color:C.gold }}>date_extract → group_summarize → balance_panel</span> → Poisson FE.
          </div>
        </div>

        {step === "fetching" && (
          <div style={{ padding:"0.4rem 1.1rem 0.9rem", color:C.textDim, fontSize:11, fontFamily:mono }}>Fetching registry…</div>
        )}
        {step === "error" && (
          <div style={{ margin:"0 1.1rem 0.9rem", padding:"0.6rem 0.75rem", background:`${C.red}15`, borderLeft:`3px solid ${C.red}`, fontSize:11, color:C.red, fontFamily:mono }}>⚠ {error}</div>
        )}
        {meta && (
          <div style={{ margin:"0 1.1rem 0.9rem", fontSize:10, color:C.textMuted, fontFamily:mono }}>
            {meta.nObs} incidents · {meta.coverage?.minDate}–{meta.coverage?.maxDate} · {meta.nUnparsedDates} unparsed dates · {meta.nDuplicatesDropped} dup dropped
          </div>
        )}

        <div style={{ padding:"0.65rem 1.1rem", background:C.bg, borderTop:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ flex:1, fontSize:9, color:C.textMuted, fontFamily:mono }}>Source: observatorioluciaperez.org · public registry</div>
          <button onClick={onClose} style={{ padding:"0.38rem 0.9rem", background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily:mono, fontSize:11 }}>Cancel</button>
          <button onClick={handleFetch} disabled={step==="fetching"}
            style={{ padding:"0.38rem 1.1rem", background:C.gold, border:"none", borderRadius:3, color:C.bg, cursor: step==="fetching"?"not-allowed":"pointer", fontFamily:mono, fontSize:11, fontWeight:700, opacity: step==="fetching"?0.6:1 }}>
            ↓ Fetch registry
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no import/JSX errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/wrangling/ObservatorioFetcher.jsx
git commit -m "feat(ui): ObservatorioFetcher modal"
```

---

### Task 10: Wire the fetcher into App.jsx

**Files:**
- Modify: `src/App.jsx` (import ~line 13; state ~810–811; trigger menu ~1161–1163; modal mount ~1252–1261)

- [ ] **Step 1: Add the import**

After `import OECDFetcher from './components/wrangling/OECDFetcher.jsx';` (line 13):

```jsx
import ObservatorioFetcher from './components/wrangling/ObservatorioFetcher.jsx';
```

- [ ] **Step 2: Add state**

After `const [oecdOpen,  setOecdOpen]  = useState(false);` (line 811):

```jsx
  const [obsOpen,   setObsOpen]   = useState(false);
```

- [ ] **Step 3: Add the trigger menu entry**

In the API-fetchers array (after the OECD entry, line 1163):

```jsx
                {label:"↓ Observatorio (femicidios)", color:C.gold, action:()=>setObsOpen(true)},
```

- [ ] **Step 4: Add the modal mount**

After the `{oecdOpen && (...)}` block (line 1261):

```jsx
      {obsOpen && (
        <ObservatorioFetcher
          onLoad={(fname, rows, headers) => {
            studioRef.current?.addApiData(fname, rows, headers);
            setObsOpen(false);
            setSuccess(`"${fname}" loaded — visible in Dataset Manager.`);
          }}
          onClose={() => setObsOpen(false)}
        />
      )}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(ui): wire ObservatorioFetcher into App data-source menu"
```

---

## Phase 6 — End-to-end validation

### Task 11: Browser validation + panel build (manual, Franco)

- [ ] **Step 1: Full suite green**

Run: `node --test src/services/data/fetchers/observatorio.test.js && cd tools/data-discovery && pytest tests/ -v`
Expected: all JS + Python tests pass.

- [ ] **Step 2: Live fetch in the app**

Run: `npm run dev`. Open the data-source menu → "↓ Observatorio (femicidios)" → Fetch. Confirm: dataset appears in Dataset Manager; no `nombre`/PII columns present; `meta` line shows sensible counts + coverage spanning ~1984→present.

- [ ] **Step 3: Build the balanced panel**

In the wrangling pipeline: `date_extract` (month from `fecha`) → `group_summarize` (group by location + month → count) → `balance_panel` (entity=location, time=month, outcome=count, fill=0). Confirm zero-count location-months appear as explicit `0` rows.

- [ ] **Step 4: Estimate**

Run a Poisson FE / Sun-Abraham event study on the balanced panel; confirm it estimates without error.

- [ ] **Step 5: Source sanity check**

Confirm the incident total (pre-aggregation) matches the figure the Observatorio publishes for the covered period.

- [ ] **Step 6: Mark spec DONE**

Update the `ClaudePlan.md` index row for `specs/2026-06-03-dynamic-data-interceptor-observatorio-design.md` from OPEN → DONE with a one-line result note. Commit:

```bash
git add ClaudePlan.md
git commit -m "docs(plan): mark Observatorio ingestion DONE after browser validation"
```

---

## Self-Review notes

- **Spec coverage:** Artifact A core (Task 2) + adapter (Task 3) + headers-in-Capture (Task 2 test asserts it); Artifact B proxy (Task 8), fetcher with PII-strip/Spanish-dates-1984+/dedup (Tasks 5,7), UI (Tasks 9,10); panel recipe via existing `balance_panel` (Task 11); validation incl. source sanity check (Task 11); dedup footnote behavior (Task 5 tests both default-on id + opt-in hash). All spec sections map to a task.
- **Discovery dependency:** Task 4 is an explicit manual checkpoint; `FIELD_MAP` + proxy `UPSTREAM_URL`/`postData` defaults are runnable guesses to be confirmed there, not placeholders.
- **Type consistency:** `Capture` fields, `normalizeFecha`/`applyWhitelist`/`dedupeIncidents`/`parseRegistry`/`fetchObservatorioRegistry` signatures, and the `onLoad(fname, rows, headers)` contract are identical across tasks and match the existing OECD pattern.
- **No real PII** is committed: fixture (Task 6) is synthetic; raw dumps are gitignored (Task 1).
```

