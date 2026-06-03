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
