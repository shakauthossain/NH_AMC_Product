from celery import Celery
from config import settings
from task_runner import run_fabric_task
from emailer import send_report_email
from logger import get_logger
from datetime import datetime, timezone

celery = Celery(__name__, broker=str(settings.BROKER_URL), backend=str(settings.RESULT_BACKEND))
log = get_logger("worker")

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

@celery.task(bind=True, name="wp.outdated.fetch")
def wp_outdated_fetch_task(self, url: str, headers: dict | None = None, report_email: str | None = None):
    log.info(f"[task {self.request.id}] wp_outdated_fetch url={url}")
    try:
        from modules.outdated_fetcher import fetch_outdated
        result = fetch_outdated(url, headers)  # now auto-appends route + content-aware
    except Exception as e:
        result = {"ok": False, "url": url, "error": str(e)}

    return result

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

    auth_tuple = (auth["username"], auth["password"]) if auth else None
    status = None

    # Helper: map human plugin names -> plugin_file slugs using status
    # Helper: map slug OR name -> plugin_file using status
    def _normalize_plugin_list(sel: list[str], status_json: dict | None) -> list[str]:
        """
        Accepts:
        - plugin_file: "dir/file.php" OR "hello.php"  (pass through)
        - slug:        "all-in-one-wp-migration"      (map -> "all-in-one-wp-migration/all-in-one-wp-migration.php")
        - name:        "All-in-One WP Migration"      (map -> plugin_file)
        """
        if not sel:
            return []
        if not status_json:
            return sel

        plugins = status_json.get("plugins") or []
        by_slug = { (p.get("slug") or "").strip().lower(): (p.get("plugin_file") or "") for p in plugins }
        by_name = { (p.get("name") or "").strip().lower(): (p.get("plugin_file") or "") for p in plugins }

        out: list[str] = []
        for s in sel:
            s0 = (str(s or "").strip())
            # Already a plugin_file? (handles both "hello.php" and "dir/file.php")
            if s0.endswith(".php"):
                out.append(s0)
                continue
            # Try slug, then human name
            pf = by_slug.get(s0.lower()) or by_name.get(s0.lower())
            out.append(pf or s0)  # fall back if unknown
        # Drop empties just in case
        return [x for x in out if x]

    # 1) Decide selection
    selected = list(plugins or [])
    selected_before = list(plugins or [])

    # Fetch status when:
    #  - we need to auto-select, or
    #  - we need to normalize provided names into slugs
    need_status_for_normalize = any(selected) and any(("/" not in s or not s.endswith(".php")) for s in selected)
    if (auto_select_outdated and not selected) or need_status_for_normalize:
        try:
            status = fetch_status(base_url, auth_tuple, headers)
        except Exception as e:
            return {"ok": False, "error": f"Status fetch failed: {e}", "url": base_url}

    if auto_select_outdated and not selected:
        selected = select_outdated_plugins(status, blocklist)
    else:
        selected = _normalize_plugin_list(selected, status)

    # Apply blocklist if caller provided explicit selection
    if blocklist:
        bl = set(blocklist)
        selected = [s for s in selected if s not in bl]

    # 2) Build result shape to mirror `wp_update_all_task`
    out = {
        "ok": True,              # will be ANDed with inner result
        "url": base_url,
        "plugins": {"selected": selected, "skipped": False, "result": None},
    }
    if status is not None:
        out["status_snapshot"] = status

    # 3) Execute or skip
    if not selected:
        out["plugins"]["skipped"] = True
    else:
        upd = update_plugins(base_url, selected, auth_tuple, headers)
        out["plugins"]["result"] = upd
        out["ok"] = bool(upd.get("ok"))
    
    log.info(f"[task {self.request.id}] normalize: {selected_before} -> {selected}")

    # Replace the whole try: ... except: block with this
    try:
        per_plugin = (
            (out.get("plugins") or {})
            .get("result", {})
            .get("result", {})
            .get("per_plugin", [])
        )
        successes = [x["plugin_file"] for x in per_plugin if x.get("updated")]
        failures  = [x["plugin_file"] for x in per_plugin if x.get("updated") is False]

        if successes:
            log.info(f"[task {self.request.id}] ✅ Plugin(s) updated: {successes}")
        if failures:
            log.warning(f"[task {self.request.id}] ❌ Plugin(s) still stale after update: {failures}")
    except Exception as e:
        log.warning(f"[task {self.request.id}] ⚠️ Failed to parse plugin result details: {e}")


    if report_email:
        try:
            send_report_email(report_email, f"[{settings.APP_NAME}] WP plugin updates for {base_url}", out or {})
        except Exception as e:
            out = {"_original": out, "_email_error": str(e)}
    return out



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

    auth_tuple = (auth["username"], auth["password"]) if auth else None

    status = None
    if precheck:
        try:
            status = fetch_status(base_url, auth_tuple, headers)
            core = (status.get("core") or {})
            if not core.get("update_available"):
                res = {
                    "ok": True,
                    "skipped": True,
                    "reason": "core is already up-to-date",
                    "current": core.get("current_version"),
                    "latest": core.get("latest_version"),
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

    auth_tuple = (auth["username"], auth["password"]) if auth else None
    result = {
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
        selected = select_outdated_plugins(status, blocklist)
        result["plugins"]["selected"] = selected
        if selected:
            upd = update_plugins(base_url, selected, auth_tuple, headers)
            result["plugins"]["result"] = upd
            plugins_ok = bool(upd.get("ok"))
        else:
            result["plugins"]["skipped"] = True

    # 3) core
    core_ok = True
    if include_core:
        core = status.get("core") or {}
        if precheck_core and not core.get("update_available"):
            result["core"].update({
                "skipped": True,
                "reason": "core already up to date",
                "current": core.get("current_version"),
                "latest": core.get("latest_version"),
            })
        else:
            upd = update_core(base_url, auth_tuple, headers)
            result["core"]["result"] = upd
            core_ok = bool(upd.get("ok"))

    result["ok"] = bool(plugins_ok and core_ok)

    if report_email:
        try:
            send_report_email(report_email, f"[{settings.APP_NAME}] WP all-updates for {base_url}", result or {})
        except Exception as e:
            result = {"_original": result, "_email_error": str(e)}
    return result

# PYTHONPATH=. celery -A celery_app worker -l info
# PYTHONPATH=. celery -A celery_app worker -l info --pool=solo
