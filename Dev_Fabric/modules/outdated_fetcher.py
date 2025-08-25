# modules/outdated_fetcher.py
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import urlparse, urlunparse

import requests

STATUS_ROUTE = "/wp-json/custom/v1/status"


# ----------------------------
# Utilities
# ----------------------------
def _ensure_status_route(url: str) -> str:
    """
    Accepts either a full /wp-json/... URL or a bare site root and returns
    a URL pointing at the status route. Preserves scheme, host, query, etc.
    """
    p = urlparse(url)
    path = (p.path or "").rstrip("/")
    if not path or path == "":
        new_path = STATUS_ROUTE
    elif path.endswith("/wp-json") or path.endswith("/wp-json/"):
        new_path = STATUS_ROUTE
    elif "/wp-json/" in path:
        # Caller already pointed inside wp-json; keep as-is
        new_path = path
    else:
        new_path = STATUS_ROUTE
    p = p._replace(path=new_path)
    return urlunparse(p)


def _split_basic_auth(auth: Optional[str]) -> Optional[Tuple[str, str]]:
    """
    Turns "user:pass" into (user, pass). Returns None if not provided or malformed.
    """
    if not auth:
        return None
    if ":" not in auth:
        return None
    user, pw = auth.split(":", 1)
    return user, pw


@dataclass
class OutdatedItem:
    name: str
    active: Optional[bool]
    current: Optional[str]
    latest: Optional[str]


# ----------------------------
# Parsers for different schemas
# ----------------------------
def _parse_new_schema(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Parse the structure produced by our custom plugin:
    {
      "ok": true,
      "core": {"installed": "6.5.5", "updates": [{ "version": "6.6", "response": "upgrade" }, ...]},
      "plugins": {"summary": {...}, "list": [{ "name": "...", "installed": "x", "available": "y", "has_update": true }]},
      "themes":  {"summary": {...}, "list": [{ "name": "...", "installed": "x", "available": "y", "has_update": true }]}
    }
    """
    if not isinstance(data, dict):
        return None
    if "plugins" not in data or "themes" not in data or "core" not in data:
        return None

    core = data.get("core") or {}
    core_installed = core.get("installed")
    core_updates = core.get("updates") or []
    # Is there any 'upgrade' response?
    core_latest_candidate = core_installed
    core_update_available = False
    for cu in core_updates:
        v = cu.get("version")
        if v:
            core_latest_candidate = v
        if (cu.get("response") or "").lower() in ("upgrade", "latest"):  # conservative
            core_update_available = core_update_available or (v is not None)

    plugins_obj = data.get("plugins") or {}
    themes_obj = data.get("themes") or {}

    plugin_list = plugins_obj.get("list") or []
    theme_list = themes_obj.get("list") or []

    plugins_outdated: List[OutdatedItem] = []
    for p in plugin_list:
        if p.get("has_update"):
            plugins_outdated.append(
                OutdatedItem(
                    name=p.get("name") or p.get("slug") or p.get("file"),
                    active=None,  # not exposed by the status route
                    current=p.get("installed"),
                    latest=p.get("available"),
                )
            )

    themes_outdated: List[OutdatedItem] = []
    for t in theme_list:
        if t.get("has_update"):
            themes_outdated.append(
                OutdatedItem(
                    name=t.get("name") or t.get("stylesheet"),
                    active=None,  # not exposed by the status route
                    current=t.get("installed"),
                    latest=t.get("available"),
                )
            )

    return {
        "plugins_outdated": [o.__dict__ for o in plugins_outdated],
        "themes_outdated": [o.__dict__ for o in themes_outdated],
        "core_update_available": bool(core_update_available),
        "core_current": core_installed,
        "core_latest": core_latest_candidate,
        # env is not returned by this route; keep keys for compatibility
        "php_version": None,
        "mysql_version": None,
    }


def _parse_legacy_schema(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Backward compatibility with your previous JSON shape where `plugins` and
    `themes` were arrays and each item had `update_available`, `version`, etc.
    """
    try:
        plugins = data.get("plugins", []) or []
        themes = data.get("themes", []) or []
    except AttributeError:
        return None

    core = data.get("core", {}) or {}
    env = data.get("php_mysql", {}) or {}

    plugin_updates = [
        {
            "name": p.get("name"),
            "active": bool(p.get("active")),
            "current": p.get("version"),
            "latest": p.get("latest_version"),
        }
        for p in plugins
        if p.get("update_available")
    ]
    theme_updates = [
        {
            "name": t.get("name"),
            "active": bool(t.get("active")),
            "current": t.get("version"),
            "latest": t.get("latest_version"),
        }
        for t in themes
        if t.get("update_available")
    ]

    return {
        "plugins_outdated": plugin_updates,
        "themes_outdated": theme_updates,
        "core_update_available": bool(core.get("update_available")),
        "core_current": core.get("current_version"),
        "core_latest": core.get("latest_version"),
        "php_version": env.get("php_version"),
        "mysql_version": env.get("mysql_version"),
    }


# ----------------------------
# Public API
# ----------------------------
def fetch_outdated(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 12,
    basic_auth: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fetches /status and returns:
    {
      "ok": True|False,
      "status_code": int,
      "url": str,
      "summary": {
        "plugins_outdated": [ {name, active, current, latest}, ... ],
        "themes_outdated":  [ ... ],
        "core_update_available": bool,
        "core_current": str|None,
        "core_latest":  str|None,
        "php_version":  str|None,
        "mysql_version": str|None
      },
      "raw": <full parsed JSON|str>
    }
    """
    final_url = _ensure_status_route(url)

    req_headers = {
        "Accept": "application/json, */*;q=0.8",
        "User-Agent": "outdated-fetcher/1.0 (+https://example.local)",
    }
    if headers:
        req_headers.update(headers)

    auth_tuple = _split_basic_auth(basic_auth)

    try:
        r = requests.get(
            final_url,
            headers=req_headers,
            timeout=timeout,
            allow_redirects=True,
            auth=auth_tuple,
        )
    except requests.RequestException as e:
        return {
            "ok": False,
            "status_code": 0,
            "url": final_url,
            "error": f"Request failed: {e}",
        }

    ct = (r.headers.get("content-type") or "").lower()
    body = r.text or ""

    looks_json = ("application/json" in ct) or body.lstrip().startswith(("{", "["))

    if not looks_json:
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

    # Try new schema first, then legacy
    summary = _parse_new_schema(data) or _parse_legacy_schema(data)
    if not summary:
        # Unknown shape; still return raw for debugging
        return {
            "ok": False,
            "status_code": r.status_code,
            "url": final_url,
            "error": "Unrecognized status schema",
            "raw": data,
        }

    return {
        "ok": True,
        "status_code": r.status_code,
        "url": final_url,
        "summary": summary,
        "raw": data,
    }

