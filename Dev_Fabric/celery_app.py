from celery import Celery
from config import settings
from task_runner import run_fabric_task
from emailer import send_report_email
from logger import get_logger
from datetime import datetime, timezone
import json
from typing import Any, Dict, List, Optional

celery = Celery(__name__, broker=str(settings.BROKER_URL), backend=str(settings.RESULT_BACKEND))
log = get_logger("worker")


# -----------------------------------------------------------------------------
# Helpers for schema-agnostic handling of WP status payloads
# -----------------------------------------------------------------------------
def _coerce_status_dict(status_like: Any) -> Dict[str, Any]:
    """
    Accept anything and return a dict that looks like the /status JSON body.
    Handles:
      - dict already at status shape
      - dicts wrapped like {"result": {...}} or {"raw": {...}}
      - string JSON bodies
    Falls back to {}.
    """
    # 1) Fast path
    if isinstance(status_like, dict):
        # unwrap common wrappers
        if "plugins" in status_like and "themes" in status_like:
            return status_like
        if "raw" in status_like and isinstance(status_like["raw"], dict):
            return status_like["raw"]
        if "result" in status_like and isinstance(status_like["result"], dict):
            inner = status_like["result"]
            if "raw" in inner and isinstance(inner["raw"], dict):
                return inner["raw"]
            if "plugins" in inner and "themes" in inner:
                return inner
        return status_like

    # 2) JSON string?
    if isinstance(status_like, str):
        try:
            parsed = json.loads(status_like.strip())
            return _coerce_status_dict(parsed)
        except Exception:
            return {}

    # 3) Unsupported type
    return {}


def _plugins_rows(status_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Return list[dict] of plugins for both schemas.
      - legacy: status["plugins"] is list[dict]
      - new:    status["plugins"] is dict with key "list" -> list[dict]
    Filters out non-dict items.
    """
    plugins_obj = (status_json or {}).get("plugins")
    if isinstance(plugins_obj, dict):
        rows = plugins_obj.get("list") or []
    elif isinstance(plugins_obj, list):
        rows = plugins_obj
    else:
        rows = []
    return [r for r in rows if isinstance(r, dict)]


# -----------------------------------------------------------------------------
# Generic Fabric runner passthrough
# -----------------------------------------------------------------------------
@celery.task(bind=True)
def run_site_task(self, site_config: dict, task_name: str, report_email: str | None = None, **kwargs):
    safe_site = {k: v for k, v in site_config.items() if k not in {"password","sudo_password","private_key_pem","db_pass","key_filename"}}
    log.info(f"[task {self.request.id}] start {task_name} site={safe_site} args={kwargs}")
    result = run_fabric_task(site_config, task_name, **kwargs)
    log.info(f"[task {self.request.id}] done {task_name} -> {('ok' if result else 'empty')}")
    if report_email:
        try:
            send_report_email(report_email, f"[{settings.APP_NAME}] Task {task_name} completed", result or {})
        except Exception as e:
            # Don’t fail the task because of email
            result = {"_original": result, "_email_error": str(e)}
    return result


# -----------------------------------------------------------------------------
# Domain / SSL checker
# -----------------------------------------------------------------------------
@celery.task(bind=True, name="domain_ssl_checker.collect")
def domain_ssl_collect_task(self, domain: str, report_email: str | None = None):
    log.info(f"[task {self.request.id}] domain_ssl_collect domain={domain}")
    try:
        from modules.domain_ssl_checker import get_domain_expiry, get_ssl_expiry
    except Exception as e:
        return {"domain": domain, "ok": False, "error": f"Import error: {e}"}

    def _aware(dt):
        if dt is None: return None
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    def _iso(dt): return _aware(dt).isoformat() if dt else None
    def _days(dt):
        dt = _aware(dt)
        return (dt - datetime.now(timezone.utc)).days if dt else None

    # WHOIS -> your function returns string or "WHOIS error: …"
    whois_raw = get_domain_expiry(domain)
    whois = {"ok": False}
    try:
        if isinstance(whois_raw, str) and not whois_raw.startswith("WHOIS error:"):
            dt = datetime.strptime(whois_raw, "%Y-%m-%d %H:%M:%S")
            whois = {"ok": True, "expiration_readable": whois_raw, "expiration": _iso(dt), "days_left": _days(dt)}
        else:
            whois = {"ok": False, "error": whois_raw}
    except Exception as e:
        whois = {"ok": False, "error": f"WHOIS parse error: {e}"}

    # SSL -> your function returns datetime or "SSL error: …"
    ssl_raw = get_ssl_expiry(domain)
    sslb = {"ok": False}
    try:
        if hasattr(ssl_raw, "strftime"):
            dt = _aware(ssl_raw)
            sslb = {"ok": True, "not_after_readable": dt.strftime("%Y-%m-%d %H:%M:%S"),
                    "not_after": _iso(dt), "days_left": _days(dt)}
        else:
            sslb = {"ok": False, "error": ssl_raw}
    except Exception as e:
        sslb = {"ok": False, "error": f"SSL parse error: {e}"}

    result = {"domain": domain.lower(), "whois": whois, "ssl": sslb,
              "ok": bool(whois.get("ok") and sslb.get("ok")),
              "checked_at": datetime.now(timezone.utc).isoformat()}

    if report_email:
        try:
            send_report_email(report_email, f"[{settings.APP_NAME}] Domain/SSL check for {domain}", result or {})
        except Exception as e:
            result = {"_original": result, "_email_error": str(e)}
    return result


# -----------------------------------------------------------------------------
# WP: Outdated fetcher task
# -----------------------------------------------------------------------------
@celery.task(bind=True, name="wp.outdated.fetch")
def wp_outdated_fetch_task(self,
                           url: str,
                           headers: dict | None = None,
                           report_email: str | None = None,
                           basic_auth: str | None = None,
                           timeout: int = 15):
    """
    Fetch WP status JSON and detect outdated core/plugins/themes.
    Supports basic_auth="user:pass" (works with WP Application Passwords).
    """
    log.info(f"[task {self.request.id}] wp_outdated_fetch url={url} auth={bool(basic_auth)} headers={bool(headers)}")
    try:
        from modules.outdated_fetcher import fetch_outdated
        result = fetch_outdated(url, headers=headers, timeout=timeout, basic_auth=basic_auth)
    except Exception as e:
        result = {"ok": False, "url": url, "error": str(e)}

    if report_email:
        try:
            send_report_email(report_email,
                              f"[{settings.APP_NAME}] Outdated check for {url}",
                              result or {})
        except Exception as e:
            result = {"_original": result, "_email_error": str(e)}

    return result


# -----------------------------------------------------------------------------
# WP: Plugins update task (schema-agnostic + robust normalization)
# -----------------------------------------------------------------------------
@celery.task(bind=True, name="wp.update.plugins")
def wp_update_plugins_task(self,
                           base_url: str,
                           plugins: list[str] | None = None,
                           auto_select_outdated: bool = True,
                           blocklist: list[str] | None = None,
                           auth: dict | None = None,
                           headers: dict | None = None,
                           report_email: str | None = None):
    log.info(f"[task {self.request.id}] wp_update_plugins url={base_url} plugins={plugins} auto={auto_select_outdated} headers={bool(headers)} auth={bool(auth)}")

    try:
        from modules.wp_updater import fetch_status, select_outdated_plugins, update_plugins
    except Exception as e:
        return {"ok": False, "error": f"Import error: {e}"}

    auth_tuple: Optional[tuple[str, str]] = (auth["username"], auth["password"]) if auth else None
    status: Any = None

    # Helper: map human plugin names -> plugin_file slugs using status
    def _normalize_plugin_list(sel: List[str], status_like: Any) -> List[str]:
        """
        Accept selection as human names, slugs, or plugin_file; return plugin_file list.
        Safe with any status shape (string, dict, wrapped dict).
        """
        if not sel:
            return []

        status_loc = _coerce_status_dict(status_like)
        rows = _plugins_rows(status_loc)

        by_slug: Dict[str, str] = {}
        by_name: Dict[str, str] = {}
        plugin_files: List[str]  = []

        for p in rows:
            plugin_file = (p.get("plugin_file") or p.get("file") or "").strip()
            if plugin_file:
                plugin_files.append(plugin_file)
            slug = (p.get("slug") or (plugin_file.split("/", 1)[0] if plugin_file else "")).strip().lower()
            name = (p.get("name") or "").strip().lower()
            if slug and plugin_file:
                by_slug[slug] = plugin_file
            if name and plugin_file:
                by_name[name] = plugin_file

        out: List[str] = []
        for s in sel:
            token = (str(s or "").strip())
            if not token:
                continue

            # Already a plugin file?
            if token.endswith(".php") and "/" in token:
                out.append(token)
                continue

            key = token.lower()

            # Try exact slug, then exact name
            pf = by_slug.get(key) or by_name.get(key)
            if pf:
                out.append(pf)
                continue

            # Try prefix match on plugin files using slug-ish token
            if "/" not in key:
                for pf2 in plugin_files:
                    if pf2.startswith(key + "/"):
                        out.append(pf2)
                        break

            # If still nothing, keep raw token; caller may decide to drop/err later
            if not out or out[-1] != token:
                out.append(token)

        # Only keep truthy strings
        return [x for x in out if isinstance(x, str) and x.strip()]

    # 1) Decide selection
    selected = list(plugins or [])
    selected_before = list(selected)

    # Fetch status when:
    #  - we need to auto-select, or
    #  - we need to normalize provided names into slugs
    need_status_for_normalize = bool(selected) and any(("/" not in s or not s.endswith(".php")) for s in selected)
    if (auto_select_outdated and not selected) or need_status_for_normalize:
        try:
            status = fetch_status(base_url, auth_tuple, headers)
        except Exception as e:
            return {"ok": False, "error": f"Status fetch failed: {e}", "url": base_url}

    # 2) Build final selection
    if auto_select_outdated and not selected:
        # Make sure we pass a dict in the shape the selector understands
        status_for_selector = _coerce_status_dict(status)
        try:
            selected = select_outdated_plugins(status_for_selector, blocklist)
        except Exception as e:
            # Fallback: derive outdated by ourselves from plugins list if selector isn't schema-agnostic
            log.warning(f"[task {self.request.id}] select_outdated_plugins failed ({e}); using fallback selector")
            rows = _plugins_rows(status_for_selector)
            bl = set(x.strip().lower() for x in (blocklist or []) if x)
            tmp: List[str] = []
            for p in rows:
                file = (p.get("plugin_file") or p.get("file") or "").strip()
                installed = p.get("version") or p.get("installed")
                available = p.get("latest_version") or p.get("available")
                has_update = p.get("update_available")
                if has_update is None and installed and available:
                    has_update = str(installed) != str(available)
                if file and bool(has_update) and file.lower() not in bl:
                    tmp.append(file)
            selected = tmp
    else:
        selected = _normalize_plugin_list(selected, status)

    # Apply blocklist if caller provided explicit selection
    if blocklist:
        bl_set = set(x.strip() for x in blocklist if x)
        selected = [s for s in selected if s not in bl_set]

    # 3) Result envelope
    out: Dict[str, Any] = {
        "ok": True,              # will be ANDed with inner result
        "url": base_url,
        "plugins": {"selected": selected, "skipped": False, "result": None},
    }
    if status is not None:
        out["status_snapshot"] = status

    # 4) Execute or skip
    if not selected:
        out["plugins"]["skipped"] = True
    else:
        upd = update_plugins(base_url, selected, auth_tuple, headers)
        out["plugins"]["result"] = upd
        out["ok"] = bool((upd or {}).get("ok"))

    log.info(f"[task {self.request.id}] normalize: {selected_before} -> {selected}")

    # 5) Summarize per-plugin results if present
    try:
        per_plugin = (
            (out.get("plugins") or {})
            .get("result", {})
            .get("result", {})
            .get("per_plugin", [])
        )
        successes = [x["plugin_file"] for x in per_plugin if isinstance(x, dict) and x.get("updated")]
        failures  = [x["plugin_file"] for x in per_plugin if isinstance(x, dict) and x.get("updated") is False]

        if successes:
            log.info(f"[task {self.request.id}] ✅ Plugin(s) updated: {successes}")
        if failures:
            log.warning(f"[task {self.request.id}] ❌ Plugin(s) still stale after update: {failures}")
    except Exception as e:
        log.warning(f"[task {self.request.id}] ⚠️ Failed to parse plugin result details: {e}")

    # 6) Optional email
    if report_email:
        try:
            send_report_email(report_email, f"[{settings.APP_NAME}] WP plugin updates for {base_url}", out or {})
        except Exception as e:
            out = {"_original": out, "_email_error": str(e)}
    return out


# -----------------------------------------------------------------------------
# WP: Core update task
# -----------------------------------------------------------------------------
@celery.task(bind=True, name="wp.update.core")
def wp_update_core_task(self,
                        base_url: str,
                        precheck: bool = True,
                        auth: dict | None = None,
                        headers: dict | None = None,
                        report_email: str | None = None):
    log.info(f"[task {self.request.id}] wp_update_core url={base_url} precheck={precheck} headers={bool(headers)} auth={bool(auth)}")

    try:
        from modules.wp_updater import fetch_status, update_core
    except Exception as e:
        return {"ok": False, "error": f"Import error: {e}"}

    auth_tuple: Optional[tuple[str, str]] = (auth["username"], auth["password"]) if auth else None

    status = None
    if precheck:
        try:
            status = fetch_status(base_url, auth_tuple, headers)
            core = (_coerce_status_dict(status).get("core") or {})
            # In your new status, core might be {"installed": "...", "updates": [...]}
            # Provide a compatible view:
            current = core.get("current_version") or core.get("installed")
            latest = core.get("latest_version")
            if not latest and isinstance(core.get("updates"), list) and core["updates"]:
                latest = core["updates"][0].get("version")
            update_available = core.get("update_available")
            if update_available is None and current and latest:
                update_available = str(current) != str(latest)

            if not update_available:
                res = {
                    "ok": True,
                    "skipped": True,
                    "reason": "core is already up-to-date",
                    "current": current,
                    "latest": latest or current,
                    "status_snapshot": status,
                }
                if report_email:
                    try:
                        send_report_email(report_email, f"[{settings.APP_NAME}] WP core update skipped ({base_url})", res or {})
                    except Exception as e:
                        res = {"_original": res, "_email_error": str(e)}
                return res
        except Exception as e:
            return {"ok": False, "error": f"Status fetch failed: {e}", "url": base_url}

    result = update_core(base_url, auth_tuple, headers)
    if status is not None:
        result["status_snapshot"] = status

    if report_email:
        try:
            send_report_email(report_email, f"[{settings.APP_NAME}] WP core update for {base_url}", result or {})
        except Exception as e:
            result = {"_original": result, "_email_error": str(e)}
    return result


# -----------------------------------------------------------------------------
# WP: Update-all task (plugins + core)
# -----------------------------------------------------------------------------
@celery.task(bind=True, name="wp.update.all")
def wp_update_all_task(
    self,
    base_url: str,
    auth: dict | None = None,           # optional Basic auth: {"username": "...", "password": "..."}
    headers: dict | None = None,        # optional headers (e.g., Bearer token)
    blocklist: list[str] | None = None, # optional plugin_file list to skip
    include_plugins: bool = True,
    include_core: bool = True,
    precheck_core: bool = True,         # skip core if already up to date
    report_email: str | None = None,
):
    log.info(f"[task {self.request.id}] wp_update_all url={base_url} include_plugins={include_plugins} include_core={include_core}")
    try:
        from modules.wp_updater import fetch_status, select_outdated_plugins, update_plugins, update_core
    except Exception as e:
        return {"ok": False, "url": base_url, "error": f"Import error: {e}"}

    auth_tuple: Optional[tuple[str, str]] = (auth["username"], auth["password"]) if auth else None
    result: Dict[str, Any] = {
        "ok": False,
        "url": base_url,
        "plugins": {"selected": [], "skipped": False, "result": None},
        "core": {"skipped": False, "result": None},
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }

    # 1) fetch status once
    try:
        status = fetch_status(base_url, auth_tuple, headers)
    except Exception as e:
        return {"ok": False, "url": base_url, "error": f"Status fetch failed: {e}"}
    result["status_snapshot"] = status

    # 2) plugins
    plugins_ok = True
    if include_plugins:
        status_dict = _coerce_status_dict(status)
        try:
            selected = select_outdated_plugins(status_dict, blocklist)
        except Exception as e:
            log.warning(f"[task {self.request.id}] select_outdated_plugins failed in update_all ({e}); using fallback selector")
            rows = _plugins_rows(status_dict)
            bl = set(x.strip().lower() for x in (blocklist or []) if x)
            selected = []
            for p in rows:
                file = (p.get("plugin_file") or p.get("file") or "").strip()
                installed = p.get("version") or p.get("installed")
                available = p.get("latest_version") or p.get("available")
                has_update = p.get("update_available")
                if has_update is None and installed and available:
                    has_update = str(installed) != str(available)
                if file and bool(has_update) and file.lower() not in bl:
                    selected.append(file)

        result["plugins"]["selected"] = selected
        if selected:
            upd = update_plugins(base_url, selected, auth_tuple, headers)
            result["plugins"]["result"] = upd
            plugins_ok = bool((upd or {}).get("ok"))
        else:
            result["plugins"]["skipped"] = True

    # 3) core
    core_ok = True
    if include_core:
        core = _coerce_status_dict(status).get("core") or {}
        current = core.get("current_version") or core.get("installed")
        latest = core.get("latest_version")
        if not latest and isinstance(core.get("updates"), list) and core["updates"]:
            latest = core["updates"][0].get("version")
        update_available = core.get("update_available")
        if update_available is None and current and latest:
            update_available = str(current) != str(latest)

        if precheck_core and not update_available:
            result["core"].update({
                "skipped": True,
                "reason": "core already up to date",
                "current": current,
                "latest": latest or current,
            })
        else:
            upd = update_core(base_url, auth_tuple, headers)
            result["core"]["result"] = upd
            core_ok = bool((upd or {}).get("ok"))

    result["ok"] = bool(plugins_ok and core_ok)

    if report_email:
        try:
            send_report_email(report_email, f"[{settings.APP_NAME}] WP all-updates for {base_url}", result or {})
        except Exception as e:
            result = {"_original": result, "_email_error": str(e)}
    return result

# PYTHONPATH=. celery -A celery_app worker -l info
# PYTHONPATH=. celery -A celery_app worker -l info --pool=solo
