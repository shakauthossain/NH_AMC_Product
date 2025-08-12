from fabric import task
from invoke.exceptions import UnexpectedExit
import json, datetime, tempfile, os
from task_runner import _take_screenshot, _tool_exists
from pathlib import Path
from shlex import quote as Q

def wp(c, path, cmd):
    return c.run(f"cd {path} && wp {cmd}", hide=True, warn=True)

@task
def ssl_expiry(c, domain):
    r = c.local(
        f"echo | openssl s_client -servername {domain} -connect {domain}:443 2>/dev/null "
        f"| openssl x509 -noout -enddate",
        hide=True, warn=True
    )
    end = (r.stdout or "").strip().split('=')[-1]
    dt = datetime.datetime.strptime(end, "%b %d %H:%M:%S %Y %Z")
    days = (dt - datetime.datetime.utcnow()).days
    return {"domain": domain, "not_after": end, "days_left": days}

@task
def wp_status(c, wp_path):
    core = wp(c, wp_path, "core check-update --format=json").stdout or "[]"
    plugins = wp(c, wp_path, "plugin list --update=available --format=json").stdout or "[]"
    themes = wp(c, wp_path, "theme list --update=available --format=json").stdout or "[]"
    return {"core": json.loads(core), "plugins": json.loads(plugins), "themes": json.loads(themes)}

@task
def backup_site(c, wp_path, db_name, db_user, db_pass, out_dir="/tmp/backups"):
    ts = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
    sql = f"{out_dir}/{db_name}-{ts}.sql.gz"
    tar = f"{out_dir}/wp-content-{ts}.tar.gz"
    c.run(f"mkdir -p {out_dir}")
    with c.prefix(f"export MYSQL_PWD='{db_pass}'"):
        c.run(f"mysqldump -u {db_user} {db_name} | gzip > {sql}")
    c.run(f"tar -C {wp_path} -czf {tar} wp-content")
    return {"db_dump": sql, "content_tar": tar, "timestamp": ts}

@task
def backup_db(c, db_name, db_user, db_pass, out_dir="/tmp/backups"):
    ts = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
    sql = f"{out_dir}/{db_name}-{ts}.sql.gz"
    c.run(f"mkdir -p {out_dir}")
    with c.prefix(f"export MYSQL_PWD='{db_pass}'"):
        c.run(f"mysqldump -u {db_user} {db_name} | gzip > {sql}")
    return {"db_dump": sql, "timestamp": ts}

@task
def backup_wp_content(c, wp_path, out_dir="/tmp/backups"):
    ts = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
    tar = f"{out_dir}/wp-content-{ts}.tar.gz"
    c.run(f"mkdir -p {out_dir}")
    c.run(f"tar -C {wp_path} -czf {tar} wp-content")
    return {"content_tar": tar, "timestamp": ts}

@task
def healthcheck(c, url, keyword=None, screenshot=False, out_path="/tmp/site.png"):
    # basic HTTP probe
    r = c.local(f"curl -s -w '%{{http_code}}' -o /tmp/_hc_body {url}", hide=True, warn=True)
    code = int((r.stdout or "")[-3:])
    body = ""
    try:
        with open("/tmp/_hc_body", "r", encoding="utf-8", errors="ignore") as fh:
            body = fh.read(2000)
    except Exception:
        pass
    ok = code == 200 and ((keyword in body) if keyword else True)

    result = {"url": url, "status": code, "ok": ok}
    if keyword:
        result["keyword_present"] = (keyword in body)

    # optional screenshot
    if screenshot:
        shot = _take_screenshot(c, url, out_path or "/tmp/site.png")
        result["screenshot"] = shot

    return result
    
@task
def provision_wp_sh(c, domain, wp_path="/var/www/html", site_title="My Site",
                    admin_user="admin", admin_pass="changeme", admin_email="admin@example.com",
                    db_name="wp_db", db_user="wp_user", db_pass="wp_pass",
                    php_version="8.1", wp_version="latest",
                    letsencrypt_email="", noninteractive="true"):
    """
    Runs the provisioning shell script on the remote host and returns the JSON report.
    - Uploads script from this module's directory.
    - Uses sudo only when needed (i.e., when not root).
    - Reads the report without sudo to avoid prompt failures.
    """
    # Always upload the script from the project folder where this file lives
    local_script = Path(__file__).parent / "wp_provision.sh"
    remote_script = "/tmp/wp_provision.sh"
    report_path = "/tmp/wp_provision_report.json"

    c.put(str(local_script), remote_script)

    # Make executable
    if c.user == "root":
        c.run(f"chmod +x {remote_script}", warn=True)
    else:
        c.sudo(f"chmod +x {remote_script}", warn=True)

    # Build command (quote everything that can contain spaces/special chars)
    cmd = (
        f"{remote_script} "
        f"{Q(domain)} {Q(wp_path)} {Q(site_title)} {Q(admin_user)} {Q(admin_pass)} {Q(admin_email)} "
        f"{Q(db_name)} {Q(db_user)} {Q(db_pass)} {Q(php_version)} {Q(wp_version)} {Q(report_path)} "
        f"{Q(letsencrypt_email)} {Q(noninteractive)}"
    )

    # Execute script
    runner = c.run if c.user == "root" else c.sudo
    runner(cmd, warn=True)

    # Read report WITHOUT sudo (script chmods it 0644; error trap writes on failure)
    out = c.run(f"cat {report_path}", hide=True, warn=False).stdout

    return json.loads(out or "{}")


@task
def update_with_rollback(c, wp_path, db_name, db_user, db_pass, out_dir="/tmp/backups"):
    """
    1) Take a snapshot (DB dump + wp-content tar)
    2) Try: wp plugin update --all
    3) On failure: restore DB + wp-content from the snapshot
    """
    # 1) snapshot
    snap = backup_site(c, wp_path, db_name, db_user, db_pass, out_dir)

    try:
        # 2) attempt updates
        r = wp(c, wp_path, "plugin update --all --format=json")
        if r.exited != 0:
            raise UnexpectedExit(r)

        # Optional: update themes/core as needed (left commented)
        # r_core = wp(c, wp_path, "core update --format=json")
        # r_themes = wp(c, wp_path, "theme update --all --format=json")

        return {
            "updated": True,
            "snapshot": snap,
            "details": {"plugins": json.loads(r.stdout or "[]")}
        }

    except Exception as e:
        # 3) restore from snapshot
        restore_errors = []

        # Restore DB
        try:
            with c.prefix(f"export MYSQL_PWD='{db_pass}'"):
                c.run(f"gunzip -c {snap['db_dump']} | mysql -u {db_user} {db_name}", warn=False)
        except Exception as db_e:
            restore_errors.append(f"db_restore: {db_e}")

        # Restore wp-content (extract over existing)
        try:
            # Ensure wp-content exists
            c.run(f"mkdir -p {wp_path}/wp-content", warn=True)
            # Extract tarball into wp_path; paths inside tar are 'wp-content/...'
            c.run(f"tar -C {wp_path} -xzf {snap['content_tar']}", warn=False)
            # Safe permissions (common defaults)
            c.run(f"find {wp_path}/wp-content -type d -exec chmod 755 {{}} +", warn=True)
            c.run(f"find {wp_path}/wp-content -type f -exec chmod 644 {{}} +", warn=True)
        except Exception as fs_e:
            restore_errors.append(f"content_restore: {fs_e}")

        return {
            "updated": False,
            "error": str(e),
            "snapshot": snap,
            "restored": len(restore_errors) == 0,
            "restore_errors": restore_errors or None
        }
        
@task
def wp_reset_sh(
    c,
    wp_path: str | None = None,              # ignored by script, kept for API compat
    domain: str | None = None,               # ignored by script, kept for API compat
    purge_stack: bool = True,                # script always purges; no flag needed
    reset_ufw: bool = True,
    force: bool = True,
    report_path: str = "/tmp/droplet_reset_report.json"  # match script default
):
    """
    Upload and run wp_reset.sh which supports only:
      --force, --no-ufw, --no-reboot
    Script writes report to /tmp/droplet_reset_report.json.
    """
    # Resolve local script reliably (don't depend on CWD)
    local_script = Path(__file__).parent / "wp_reset.sh"
    remote_script = "/tmp/wp_reset.sh"

    c.put(str(local_script), remote_script)
    c.sudo(f"chmod +x {remote_script}")

    flags: list[str] = []
    if force:
        flags.append("--force")
    # Our API provides reset_ufw=True to mean "reset firewall".
    # Script uses --no-ufw to SKIP firewall work, so invert accordingly.
    if not reset_ufw:
        flags.append("--no-ufw")

    # (Optional) Avoid surprise reboot; uncomment if you want no reboot by default:
    # flags.append("--no-reboot")

    cmd = " ".join([remote_script] + flags)
    r = c.sudo(cmd, warn=True)

    # Try requested report_path first (if user changed it in future script versions),
    # then fall back to the script's current default path.
    default_report = "/tmp/droplet_reset_report.json"
    candidates = [report_path or default_report]
    if default_report not in candidates:
        candidates.append(default_report)

    out = ""
    last_err = None
    for p in candidates:
        try:
            out = c.run(f"cat {p}", hide=True, warn=False).stdout
            if out:
                break
        except Exception as e:
            last_err = e

    if not out:
        return {"status": "unknown", "error": f"report not found", "tried": candidates, "exec_ok": r.ok}

    try:
        return json.loads(out)
    except Exception:
        return {"status": "unknown", "raw": out.strip(), "parsed": False}
    
@task
def wp_diag_log(c, log_path="/var/log/wp_provision.log"):
    return {
        "whoami": c.run("whoami", hide=True).stdout.strip(),
        "php": c.run("php -v | head -n1", hide=True, warn=True).stdout.strip(),
        "mysql": c.run("systemctl is-active mysql || true", hide=True).stdout.strip(),
        "nginx_test": c.run("nginx -t 2>&1 || true", hide=True).stdout,
        "tail": c.run(f"tail -n 200 {log_path} || echo 'log missing'", hide=True).stdout,
    }

@task
def wp_finalize_install(c, wp_path, url, title, admin_user, admin_pass, admin_email, locale="en_US"):
    def wp(cmd): return c.run(f"cd {wp_path} && sudo -u www-data wp {cmd}", hide=True, warn=True)

    # Ensure WP-CLI present
    if not c.run("command -v /usr/local/bin/wp", hide=True, warn=True).ok:
        c.sudo("curl -sSLo /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar", warn=True)
        c.sudo("chmod +x /usr/local/bin/wp", warn=True)

    # If config missing, create it (assumes DB is ready and wp-config values are known)
    if not c.run(f"test -f {wp_path}/wp-config.php", hide=True, warn=True).ok:
        return {"ok": False, "error": "wp-config.php missing; run full provision or supply DB vars in a dedicated task."}

    # Install core if not already installed
    if not wp("core is-installed").ok:
        r = wp(f'core install --skip-email --url="{url}" --title="{title}" '
               f'--admin_user="{admin_user}" --admin_password="{admin_pass}" --admin_email="{admin_email}"')
        if not r.ok:
            return {"ok": False, "error": "core install failed", "stdout": r.stdout, "stderr": r.stderr}

    # Language (install + activate)
    if locale and locale != "en_US":
        wp(f"language core install {locale}")
        wp(f"language core activate {locale}")

    # Basic hardening / nice defaults
    wp('option update blog_public 0')
    wp('rewrite structure "/%postname%/" && wp rewrite flush --hard')

    v = wp("core version").stdout.strip()
    return {"ok": True, "wordpress_version": v, "locale": locale}