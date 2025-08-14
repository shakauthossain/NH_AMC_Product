# modules/outdated_fetcher.py
from __future__ import annotations
import requests, json
from typing import Dict, Any, Optional
from urllib.parse import urlparse, urlunparse

STATUS_ROUTE = "/wp-json/site/v1/status"

def _ensure_status_route(url: str) -> str:
    p = urlparse(url)
    # If caller gave only host or "/", default to the status route
    if p.path in ("", "/"):
        p = p._replace(path=STATUS_ROUTE)
    return urlunparse(p)

def fetch_outdated(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 12) -> Dict[str, Any]:
    final_url = _ensure_status_route(url)
    req_headers = {"Accept": "application/json, */*;q=0.8"}
    if headers:
        req_headers.update(headers)

    r = requests.get(final_url, headers=req_headers, timeout=timeout, allow_redirects=True)

    ct = (r.headers.get("content-type") or "").lower()
    body = r.text or ""

    # Only parse JSON when it looks like JSON
    is_json = ("application/json" in ct) or body.lstrip().startswith(("{", "["))

    if not is_json:
        return {
            "ok": False,
            "status_code": r.status_code,
            "url": final_url,
            "error": "Response is not JSON",
            "content_type": ct or "unknown",
            "body_preview": body[:200],
        }

    # Parse JSON safely (handle BOM/whitespace)
    try:
        data = r.json()
    except json.JSONDecodeError as e:
        try:
            data = json.loads(body.lstrip("\ufeff").strip())
        except Exception:
            return {
                "ok": False,
                "status_code": r.status_code,
                "url": final_url,
                "error": f"Invalid JSON: {e}",
                "content_type": ct,
                "body_preview": body[:200],
            }

    # Summaries
    plugins = data.get("plugins", []) or []
    themes  = data.get("themes", []) or []
    core    = data.get("core", {})   or {}
    env     = data.get("php_mysql", {}) or {}

    plugin_updates = [
        {
            "name": p.get("name"),
            "active": bool(p.get("active")),
            "current": p.get("version"),
            "latest": p.get("latest_version"),
        }
        for p in plugins if p.get("update_available")
    ]
    theme_updates = [
        {
            "name": t.get("name"),
            "active": bool(t.get("active")),
            "current": t.get("version"),
            "latest": t.get("latest_version"),
        }
        for t in themes if t.get("update_available")
    ]

    return {
        "ok": True,
        "status_code": r.status_code,
        "url": final_url,
        "summary": {
            "plugins_outdated": plugin_updates,
            "themes_outdated": theme_updates,
            "core_update_available": bool(core.get("update_available")),
            "core_current": core.get("current_version"),
            "core_latest": core.get("latest_version"),
            "php_version": env.get("php_version"),
            "mysql_version": env.get("mysql_version"),
        },
        "raw": data,
    }
