# modules/wp_updater.py
from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple
import requests
import time

# ---------- URL helpers ----------

def _urls(base_url: str) -> Dict[str, str]:
    base = base_url.rstrip("/")
    return {
        "status": f"{base}/wp-json/custom/v1/status",
        "plugins": f"{base}/wp-json/custom/v1/update-plugins",
        "core":    f"{base}/wp-json/custom/v1/update-core",
    }

def _auth_or_headers(
    auth: Optional[Tuple[str, str]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 600,  # generous because plugin updates can take a while
) -> Dict[str, Any]:
    kw: Dict[str, Any] = {"timeout": timeout}
    if auth:
        kw["auth"] = auth
    if headers:
        kw["headers"] = headers
    return kw

# ---------- Status + selection ----------

def fetch_status(
    base_url: str,
    auth: Optional[Tuple[str, str]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30,
) -> Dict[str, Any]:
    u = _urls(base_url)["status"]
    r = requests.get(u, **_auth_or_headers(auth, headers, timeout=timeout))
    r.raise_for_status()
    return r.json()

def select_outdated_plugins(
    status_json: Dict[str, Any],
    blocklist: Optional[List[str]] = None
) -> List[str]:
    """
    Return plugin_file entries that have update_available=True, minus any blocklisted items.
    """
    block = set(blocklist or [])
    result: List[str] = []
    for p in status_json.get("plugins", []) or []:
        if p.get("update_available"):
            plugin_file = p.get("plugin_file")
            if plugin_file and plugin_file not in block:
                result.append(plugin_file)
    return result

# ---------- Introspection helpers ----------

def _plugin_versions_map(status_json: Dict[str, Any]) -> Dict[str, Dict[str, Optional[str]]]:
    """
    Map plugin_file -> {current, latest}
    """
    out: Dict[str, Dict[str, Optional[str]]] = {}
    for p in (status_json.get("plugins") or []):
        pf = p.get("plugin_file")
        if pf:
            out[pf] = {"current": p.get("version"), "latest": p.get("latest_version")}
    return out

def _looks_updated(before: Dict[str, Dict[str, Optional[str]]],
                   after: Dict[str, Dict[str, Optional[str]]],
                   plugin_file: str) -> bool:
    """
    Heuristic: updated if the version changed OR after.current == after.latest
    """
    b = before.get(plugin_file) or {}
    a = after.get(plugin_file) or {}
    return (b.get("current") != a.get("current")) or (a.get("current") == a.get("latest"))

# ---------- Core update ----------

def update_core(
    base_url: str,
    auth: Optional[Tuple[str, str]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 600,
) -> Dict[str, Any]:
    """
    Triggers a WordPress core update via custom endpoint.
    """
    u = _urls(base_url)["core"]
    r = requests.post(u, **_auth_or_headers(auth, headers, timeout=timeout))
    try:
        data = r.json()
    except Exception:
        data = {"raw": (r.text or "")[:1000]}
    return {"ok": r.ok, "status_code": r.status_code, "url": u, "response": data}

# ---------- Plugin updates (robust) ----------

def update_plugins(
    base_url: str,
    plugins: List[str],
    auth: Optional[Tuple[str, str]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout_per_call: int = 600,
    settle_secs: float = 1.0,
) -> Dict[str, Any]:
    """
    Update one or more plugins with multiple fallbacks:
      1) Batch form body first:  plugins="a/b.php,c/d.php"&mode=bulk|single
      2) Batch JSON body:        {"plugins": [...], "mode": ...}
      3) One-by-one (form then JSON) for any that still fail

    Also verifies post-update status to confirm version bumps or up_to_date.
    """
    if not plugins:
        return {"ok": False, "error": "No plugins provided"}

    urls = _urls(base_url)
    u_plugins = urls["plugins"]

    # Snapshot BEFORE to verify later
    try:
        before = fetch_status(base_url, auth, headers, timeout=30)
    except Exception as e:
        return {"ok": False, "url": base_url, "error": f"Status (before) fetch failed: {e}"}
    before_map = _plugin_versions_map(before)

    # Decide mode explicitly (optional but helpful)
    mode = "single" if len(plugins) == 1 else "bulk"

    def _post_form(plugs: List[str]) -> requests.Response:
        hdrs = {"Content-Type": "application/x-www-form-urlencoded"}
        merged = {**(headers or {}), **hdrs}
        return requests.post(
            u_plugins,
            data={"plugins": ",".join(plugs), "mode": mode},
            **_auth_or_headers(auth, merged, timeout=timeout_per_call)
        )

    def _post_json(plugs: List[str]) -> requests.Response:
        hdrs = {"Content-Type": "application/json"}
        merged = {**(headers or {}), **hdrs}
        return requests.post(
            u_plugins,
            json={"plugins": plugs, "mode": mode},
            **_auth_or_headers(auth, merged, timeout=timeout_per_call)
        )

    attempts: List[Dict[str, Any]] = []
    per_plugin: List[Dict[str, Any]] = []
    last_ok = False

    # 1) Try batch FORM first (best match for your PHP)
    try:
        r = _post_form(plugins)
        attempts.append({"mode": "batch_form", "status": r.status_code, "ok": r.ok, "body": (r.text or "")[:800]})
        last_ok = r.ok
    except Exception as e:
        attempts.append({"mode": "batch_form_exc", "error": str(e)})
        last_ok = False

    # 2) If form failed, try batch JSON
    if not last_ok:
        try:
            r = _post_json(plugins)
            attempts.append({"mode": "batch_json", "status": r.status_code, "ok": r.ok, "body": (r.text or "")[:800]})
            last_ok = r.ok
        except Exception as e:
            attempts.append({"mode": "batch_json_exc", "error": str(e)})
            last_ok = False

    time.sleep(settle_secs)

    # Check which plugins still look stale after batch
    try:
        after_batch = fetch_status(base_url, auth, headers, timeout=30)
        after_batch_map = _plugin_versions_map(after_batch)
    except Exception:
        after_batch = None
        after_batch_map = {}

    def _is_up_to_date(pf: str) -> bool:
        """Consider success if version didn't change but after.current == after.latest."""
        return _looks_updated(before_map, after_batch_map, pf)

    needs_fix = []
    if after_batch_map:
        for pf in plugins:
            if not _is_up_to_date(pf):
                needs_fix.append(pf)
    else:
        needs_fix = list(plugins)

    # 3) One-by-one fallback (only those that didn't move)
    if needs_fix:
        for pf in needs_fix:
            ok_form = ok_json = None
            status_form = status_json = None
            body_form = body_json = None

            try:
                rf = _post_form([pf])
                ok_form = rf.ok
                status_form = rf.status_code
                body_form = (rf.text or "")[:800]
            except Exception as e:
                ok_form = False
                status_form = None
                body_form = f"exception: {e}"

            if not ok_form:
                try:
                    rj = _post_json([pf])
                    ok_json = rj.ok
                    status_json = rj.status_code
                    body_json = (rj.text or "")[:800]
                except Exception as e:
                    ok_json = False
                    status_json = None
                    body_json = f"exception: {e}"

            time.sleep(settle_secs)
            try:
                post = fetch_status(base_url, auth, headers, timeout=30)
                post_map = _plugin_versions_map(post)
                updated = _looks_updated(before_map, post_map, pf)
            except Exception:
                updated = False

            per_plugin.append({
                "plugin_file": pf,
                "form": {"ok": ok_form, "status": status_form, "body": body_form},
                "json": {"ok": ok_json, "status": status_json, "body": body_json},
                "updated": updated,
            })

    # Final verdict
    if per_plugin:
        overall_updated = all(x.get("updated") for x in per_plugin)
    else:
        overall_updated = bool(after_batch_map) and all(_looks_updated(before_map, after_batch_map, pf) for pf in plugins)

    result: Dict[str, Any] = {
        "ok": bool(overall_updated),
        "url": u_plugins,
        "request_plugins": plugins,
        "mode": mode,
        "result": {
            "batch": attempts,
            "per_plugin": per_plugin,
        }
    }
    if after_batch:
        result["post_status"] = after_batch

    return result