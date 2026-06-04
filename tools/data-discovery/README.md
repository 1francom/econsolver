# data-discovery

One-off discovery tool for dynamic (XHR/fetch-served) datasets. NOT part of the
Litux build — pure dev utility. See
`docs/superpowers/specs/2026-06-03-dynamic-data-interceptor-observatorio-design.md`.

## Install
```bash
cd tools/data-discovery
py -3.13 -m venv .venv                              # pin to 3.13 — see note below
./.venv/Scripts/python.exe -m pip install -r requirements.txt
./.venv/Scripts/python.exe -m playwright install chromium
```

> **Why pin to 3.13 / call the venv python directly?**
> On this machine bare `python` resolves to **Python 3.14**, but playwright 1.48
> ships no 3.14 wheel, so `python -m playwright` fails with *"No module named
> playwright"*. Building the venv with `py -3.13` and invoking
> `./.venv/Scripts/python.exe` avoids both the version mismatch and the need to
> activate. PowerShell activation is `.\.venv\Scripts\Activate.ps1` (note the
> leading dot in `.venv` and the `.ps1` extension — plain `activate` is bash-only).

### Verified setup (2026-06-04)
- venv created with Python 3.13 (`py -3.13 -m venv .venv`)
- `playwright==1.48.0`, `pandas==2.2.3` installed into the venv
- Chromium 130.0.6723.31 (playwright build v1140) + FFMPEG v1010 downloaded
- imports resolve (`from playwright.sync_api import sync_playwright`, `pandas 2.2.3`)
- `pytest tests/` → **3 passed** (`pytest==8.3.3` now pinned in `requirements.txt`)

## Run discovery for the Observatorio
```bash
python observatorio.py
# → out/manifest.json, out/NNN_*.json, out/observatorio_clean.csv
```

## Run tests
```bash
pytest tests/ -v
```

## Verify the in-app parser against a real payload
The Observatorio sits behind Imunify360, so there is no headless/proxy capture.
Save the admin-ajax.php JSON from your own logged-in browser session (console
snippet in `ObservatorioFetcher.jsx`) to `out/registro.json`, then:
```bash
node verify_import.mjs out/registro.json
```
This runs the live in-app parser (`src/services/data/fetchers/observatorio.js`)
and prints ONLY PII-stripped aggregates (province list, date span, age range,
dup/unparsed counts, leak guard). First line of defense if the source ever
changes its positional column order.

`out/` is gitignored — raw dumps may contain PII and must stay local.
