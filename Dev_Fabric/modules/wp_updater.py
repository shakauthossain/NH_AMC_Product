# modules/wp_updater.py
from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple
import requests

def _urls(base_url: str) -> Dict[str, str]:
    base = base_url.rstrip("/")
    return {
        "status": f"{base}/wp-json/site/v1/status",
        "plugins": f"{base}/wp-json/custom/v1/update-plugins",
        "core":    f"{base}/wp-json/custom/v1/update-core",
    }

def _auth_or_headers(auth: Optional[Tuple[str, str]] = None,
                     headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    kw: Dict[str, Any] = {"timeout": 20}
    if auth:
        kw["auth"] = auth
    if headers:
        kw["headers"] = headers
    return kw

def fetch_status(base_url: str,
                 auth: Optional[Tuple[str, str]] = None,
                 headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    u = _urls(base_url)["status"]
    r = requests.get(u, **_auth_or_headers(auth, headers))
    r.raise_for_status()
    return r.json()

def select_outdated_plugins(status_json: Dict[str, Any],
                            blocklist: Optional[List[str]] = None) -> List[str]:
    block = set(blocklist or [])
    result: List[str] = []
    for p in status_json.get("plugins", []) or []:
        if p.get("update_available"):
            plugin_file = p.get("plugin_file")
            if plugin_file and plugin_file not in block:
                result.append(plugin_file)
    return result

def update_plugins(base_url: str,
                   plugins: List[str],
                   auth: Optional[Tuple[str, str]] = None,
                   headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    if not plugins:
        return {"ok": False, "error": "No plugins provided"}
    u = _urls(base_url)["plugins"]
    payload = {"plugins": ",".join(plugins)}
    hdrs = {"Content-Type": "application/x-www-form-urlencoded"}
    # allow extra headers to merge (e.g., tokens), but keep content-type
    merged_headers = {**(headers or {}), **hdrs}
    r = requests.post(u, data=payload, **_auth_or_headers(auth, merged_headers))
    try:
        data = r.json()
    except Exception:
        data = {"raw": (r.text or "")[:1000]}
    return {"ok": r.ok, "status_code": r.status_code, "url": u, "request_plugins": plugins, "response": data}

def update_core(base_url: str,
                auth: Optional[Tuple[str, str]] = None,
                headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    u = _urls(base_url)["core"]
    r = requests.post(u, **_auth_or_headers(auth, headers))
    try:
        data = r.json()
    except Exception:
        data = {"raw": (r.text or "")[:1000]}
    return {"ok": r.ok, "status_code": r.status_code, "url": u, "response": data}
