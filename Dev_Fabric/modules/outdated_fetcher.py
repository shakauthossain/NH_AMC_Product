# modules/outdated_fetcher.py
from __future__ import annotations
import requests
from typing import Dict, Any, Optional

def fetch_outdated(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 12) -> Dict[str, Any]:
    r = requests.get(url, headers=headers or {}, timeout=timeout)
    data = r.json()

    # Summaries
    plugins = data.get("plugins", []) or []
    themes = data.get("themes", []) or []
    core   = data.get("core", {}) or {}
    env    = data.get("php_mysql", {}) or {}

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
        "url": url,
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