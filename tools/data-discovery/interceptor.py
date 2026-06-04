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
    def intercept(self, url: str, pattern: str, *, wait_for: str = "networkidle", dwell_ms: int = 0) -> list[Capture]:
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
            if dwell_ms:
                page.wait_for_timeout(dwell_ms)  # let lazy XHR/fetch fire after load
            browser.close()
        return captures
