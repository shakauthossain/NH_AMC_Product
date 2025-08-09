from fabric import task
from invoke.exceptions import UnexpectedExit
import json, datetime, tempfile, os
from task_runner import _take_screenshot, _tool_exists

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
    remote_script = "/tmp/wp_provision.sh"
    c.put("wp_provision.sh", remote_script)
    c.sudo(f"chmod +x {remote_script}")
    report_path = "/tmp/wp_provision_report.json"
    cmd = (
        f"{remote_script} {domain} {wp_path} '{site_title}' {admin_user} '{admin_pass}' {admin_email} "
        f"{db_name} {db_user} '{db_pass}' {php_version} {wp_version} {report_path} {letsencrypt_email} {noninteractive}"
    )
    r = c.sudo(cmd, warn=True)
    out = c.sudo(f"cat {report_path}", hide=True).stdout
    return json.loads(out)

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
def wp_reset_sh(c,
                wp_path: str | None = None,
                domain: str | None = None,
                purge_stack: bool = True,
                reset_ufw: bool = True,
                force: bool = True,
                report_path: str = "/tmp/wp_rollback_report.json"):
    remote_script = "/tmp/wp_reset.sh"
    c.put("wp_reset.sh", remote_script)
    c.sudo(f"chmod +x {remote_script}")

    flags = []
    if wp_path:     flags += ["--path", wp_path]
    if domain:      flags += ["--domain", domain]
    if report_path: flags += ["--report", report_path]
    if force:       flags += ["--force"]
    if purge_stack: flags += ["--purge-stack"]
    if reset_ufw:   flags += ["--reset-ufw"]

    cmd = " ".join([remote_script] + [str(x) for x in flags])
    c.sudo(cmd, warn=True)

    out = c.sudo(f"cat {report_path}", hide=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {"status": "unknown", "raw": out.strip()}