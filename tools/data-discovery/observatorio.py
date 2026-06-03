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
