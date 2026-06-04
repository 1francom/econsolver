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
# The registry data is served by WordPress admin-ajax.php (wpDataTables).
PATTERN = r"admin-ajax\.php"

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
    # NOTE: this site sits behind Imunify360 bot-protection — headless capture is
    # blocked at the WAF. Kept for reference only; the live import path is the
    # in-app paste/file importer fed from the user's own browser session.
    caps = DynamicDataInterceptor().intercept(URL, PATTERN, dwell_ms=8000)
    DynamicDataInterceptor.dump(caps, OUT)
    print(f"\nCaptured {len(caps)} responses → {OUT}/manifest.json\n")
    for c in caps:
        print(f"  [{c.status}] {c.content_type[:28]:28} {len(c.body_bytes):>9}B  {c.url[:110]}")

    # Don't abort discovery if the registry list isn't auto-located — the
    # summary above + manifest.json are the ground truth we're after.
    try:
        df = clean(to_dataframe(caps))
        out_csv = OUT / "observatorio_clean.csv"
        df.to_csv(out_csv, index=False)
        print(f"\nWrote {len(df)} rows → {out_csv}")
    except SystemExit as e:
        print(f"\n[discovery] {e}")
        print("[discovery] Scan the summary above for the data request "
              "(json/csv/octet-stream body), then tell me its URL + body.")


if __name__ == "__main__":
    main()
