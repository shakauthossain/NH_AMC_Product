from fabric import Connection, Config
import tempfile, os, stat

def _materialize_key(site: dict) -> str | None:
    if site.get("private_key_pem"):
        fd, path = tempfile.mkstemp(prefix="sshkey_", text=True)
        with os.fdopen(fd, "w") as f:
            f.write(site["private_key_pem"])
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        return path
    if site.get("key_filename"):
        return site["key_filename"]
    return None

def _connect_kwargs(site: dict) -> dict:
    kw = {}
    key_path = _materialize_key(site)
    if key_path:
        kw["key_filename"] = key_path
        # make behavior deterministic
        kw["allow_agent"] = False
        kw["look_for_keys"] = False
    elif site.get("password"):
        kw["password"] = site["password"]
        # critical for password auth
        kw["allow_agent"] = False
        kw["look_for_keys"] = False
        # be generous with banners/timeouts
        kw["banner_timeout"] = 60
        kw["auth_timeout"] = 30
    return kw

def _conn_params(site: dict) -> dict:
    cfg = Config(overrides={"sudo": {"password": site.get("sudo_password") or site.get("password")}})
    params = {
        "host": site["host"],
        "user": site["user"],
        "connect_kwargs": _connect_kwargs(site),
        "connect_timeout": 30,
        "config": cfg,                         # pass sudo password here
    }
    if site.get("port"): params["port"] = site["port"]
    return params

def _normalize_site(site: dict) -> dict:
    site = dict(site)  # shallow copy
    if not site.get("sudo_password") and site.get("password"):
        site["sudo_password"] = site["password"]
    return site

def run_fabric_task(site, task_name, **kwargs):
    import fabric_tasks as ft
    func = getattr(ft, task_name)
    site = _normalize_site(site)  # <— add this
    key_created = bool(site.get("private_key_pem"))
    key_path = _materialize_key(site)
    params = _conn_params(site)
    try:
        with Connection(**params) as c:
            return func(c, **kwargs)
    finally:
        if key_created and key_path:
            try: os.remove(key_path)
            except Exception: pass

def verify_ssh(site: dict) -> dict:
    site = _normalize_site(site) 
    key_created = bool(site.get("private_key_pem"))
    key_path = _materialize_key(site)
    params = _conn_params(site)
    try:
        with Connection(**params) as c:
            r = c.run("echo ok && uname -a", hide=True, warn=False)
            return {"ok": r.ok, "stdout": r.stdout.strip()}
    finally:
        if key_created and key_path:
            try: os.remove(key_path)
            except Exception: pass

            
def _tool_exists(c, cmd):
    return c.local(f"command -v {cmd}", hide=True, warn=True).ok

def _take_screenshot(c, url: str, out_path: str) -> dict:
    """
    Try wkhtmltoimage first, then headless Chrome/Chromium.
    Returns {"ok": bool, "path": out_path, "tool": str, "error": Optional[str]}
    """
    # Ensure parent dir
    parent = os.path.dirname(out_path) or "/tmp"
    c.local(f"mkdir -p {parent}", hide=True, warn=True)

    # 1) wkhtmltoimage
    if _tool_exists(c, "wkhtmltoimage"):
        r = c.local(f"wkhtmltoimage --format png --width 1366 --height 0 {url} {out_path}", hide=True, warn=True)
        if r.ok and _tool_exists(c, "file"):  # sanity check
            return {"ok": True, "path": out_path, "tool": "wkhtmltoimage", "error": None}

    # 2) Chrome/Chromium
    for chrome in ("google-chrome", "google-chrome-stable", "chromium-browser"):
        if _tool_exists(c, chrome):
            # Many builds allow specifying the output path directly
            cmd = (
                f"{chrome} --headless --disable-gpu --hide-scrollbars "
                f"--window-size=1366,768 --screenshot={out_path} {url}"
            )
            r = c.local(cmd, hide=True, warn=True)
            if r.ok:
                return {"ok": True, "path": out_path, "tool": chrome, "error": None}
            # Some builds always write to screenshot.png in CWD; handle that
            fallback = "screenshot.png"
            if os.path.exists(fallback):
                try:
                    os.replace(fallback, out_path)
                    return {"ok": True, "path": out_path, "tool": chrome, "error": None}
                except Exception as mv_e:
                    return {"ok": False, "path": out_path, "tool": chrome, "error": f"move_failed: {mv_e}"}

    return {
        "ok": False,
        "path": out_path,
        "tool": None,
        "error": "No screenshot tool found (install wkhtmltoimage or Chrome/Chromium headless)."
    }
    
