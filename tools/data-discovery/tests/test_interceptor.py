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
