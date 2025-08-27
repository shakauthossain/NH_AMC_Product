from fastapi import FastAPI, HTTPException, Header, Depends, Request, BackgroundTasks, Body
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from celery.result import AsyncResult
from celery_app import (
    run_site_task, celery, domain_ssl_collect_task, 
    wp_outdated_fetch_task, wp_update_plugins_task, 
    wp_update_core_task, wp_update_all_task)
from schemas import (
    DomainSSLCollectorRequest, SiteConfig, SSLCheckRequest, 
    HealthcheckRequest, TaskEnqueueResponse, TaskResultResponse, 
    WPInstallRequest, SiteConnection, SiteIdResponse, WPInstallRequest, 
    TaskEnqueueResponse, TaskResultResponse, WPResetRequest, WPOutdatedFetchRequest,
    WPUpdatePluginsRequest, WPUpdateCoreRequest, WPUpdateAllRequest,
    BackupDbRequest, BackupContentRequest)
from logger import get_logger
from task_runner import verify_ssh, _conn_params, _normalize_site, _materialize_key
from config import settings
import uuid
import os, tempfile, shutil
from celery.result import AsyncResult
from fabric import Connection
    
app = FastAPI(title="NH AMC MVP")
log = get_logger("api")
SITES: dict[str, dict] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _extract_bearer(token_header: str | None) -> str | None:
    if not token_header:
        return None
    parts = token_header.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None

def require_reset_token(
    authorization: str | None = Header(default=None),
    x_reset_token: str | None = Header(default=None)
):
    expected = settings.RESET_TOKEN
    if not expected:
        # hard-fail if not configured; prevents accidental open endpoint
        raise HTTPException(status_code=503, detail="RESET_TOKEN not configured")
    supplied = x_reset_token or _extract_bearer(authorization)
    if supplied != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing reset token")
    return True

@app.get("/")
def root():
    return {"ok": True, "service": "NH AMC Fabric MVP"}

@app.post("/tasks/backup", response_model=TaskEnqueueResponse)
def trigger_backup(site: SiteConfig):
    site.user = "root"  # <--
    task = run_site_task.delay(site.dict(), "backup_site",
                               wp_path=site.wp_path, db_name=site.db_name,
                               db_user=site.db_user, db_pass=site.db_pass)
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/wp-status", response_model=TaskEnqueueResponse)
def trigger_wp_status(site: SiteConfig):
    site.user = "root"  # <--
    task = run_site_task.delay(site.dict(), "wp_status", wp_path=site.wp_path)
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/update", response_model=TaskEnqueueResponse)
def trigger_update(site: SiteConfig):
    site.user = "root"  # <--
    task = run_site_task.delay(site.dict(), "update_with_rollback",
                               wp_path=site.wp_path, db_name=site.db_name,
                               db_user=site.db_user, db_pass=site.db_pass)
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/ssl-expiry", response_model=TaskEnqueueResponse)
def trigger_ssl(req: SSLCheckRequest, site: SiteConfig):
    site.user = "root"  # <--
    task = run_site_task.delay(site.dict(), "ssl_expiry", domain=req.domain)
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/healthcheck", response_model=TaskEnqueueResponse)
def trigger_health(req: HealthcheckRequest, site: SiteConfig):
    site.user = "root"  # <--
    task = run_site_task.delay(site.dict(), "healthcheck",
                               url=req.url, keyword=req.keyword,
                               screenshot=req.screenshot, out_path=req.out_path)
    return {"task_id": task.id, "status": "queued"}

@app.post("/ssh/login", response_model=SiteIdResponse, summary="Verify SSH and create a site session")
def ssh_login(conn: SiteConnection):
    site = conn.dict()
    site["user"] = "root"               
    check = verify_ssh(site)
    if not check.get("ok"):
        raise HTTPException(status_code=400, detail="SSH verification failed")
    site_id = str(uuid.uuid4())
    SITES[site_id] = site      
    site["user"] = "root"       
    return {"site_id": site_id, "verified": True}


@app.get("/sites/{site_id}")
def get_site(site_id: str):
    site = SITES.get(site_id)
    if not site:
        raise HTTPException(404, "Unknown site_id")
    # don’t leak key; just basic info
    return {"site_id": site_id, "host": site["host"], "user": site["user"], "wp_path": site["wp_path"]}

@app.post("/tasks/wp-install/{site_id}", response_model=TaskEnqueueResponse, summary="Install WP using a saved SSH session")
def trigger_wp_install(site_id: str, req: WPInstallRequest):
    site = SITES.get(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Unknown site_id")
    site_for_task = {**site, "user": "root"}  
    task = run_site_task.delay(
        site_for_task, "provision_wp_sh",
        report_email=req.report_email,
        domain=req.domain,
        wp_path=req.wp_path,
        site_title=req.site_title,
        admin_user=req.admin_user,
        admin_pass=req.admin_pass,
        admin_email=req.admin_email,
        db_name=req.db_name,
        db_user=req.db_user,
        db_pass=req.db_pass,
        php_version=req.php_version,
        wp_version=req.wp_version,
    )
    return {"task_id": task.id, "status": "queued"}


@app.get("/tasks/{task_id}", response_model=TaskResultResponse)
def get_task(task_id: str):
    res = AsyncResult(task_id, app=celery)
    payload = {"task_id": task_id, "state": res.state}
    if res.successful():
        payload["result"] = res.result
    elif res.failed():
        payload["info"] = str(res.info)
    return JSONResponse(payload)

@app.post("/tasks/wp-reset", response_model=TaskEnqueueResponse, summary="Hard reset the droplet to a clean state")
def trigger_wp_reset(
    req: WPResetRequest,
    site: SiteConfig,
    _ok: bool = Depends(require_reset_token),
    request: Request = None  # optional, lets us read raw body if needed
):
    # Log the parsed models
    log.info(f"[wp-reset] Parsed req: {req.dict()}")
    log.info(f"[wp-reset] Parsed site: {site.dict()}")

    # If you also want raw JSON from frontend (before pydantic parsing)
    if request is not None:
        try:
            raw_body = request.json()
            log.info(f"[wp-reset] Raw incoming body: {raw_body}")
        except Exception as e:
            log.warning(f"[wp-reset] Could not read raw body: {e}")

    # Enforce required values
    if not site.host or not site.host.strip():
        raise HTTPException(status_code=422, detail="site.host is required")

    site.user = "root"
    task = run_site_task.delay(
        site.dict(),
        "wp_reset_sh",
        wp_path=req.wp_path,
        domain=req.domain,
        purge_stack=req.purge_stack,
        reset_ufw=req.reset_ufw,
        force=req.force,
        report_path=req.report_path
    )
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/domain-ssl-collect", response_model=TaskEnqueueResponse, summary="Check domain WHOIS + SSL (local task)")
def trigger_domain_ssl_collect(req: DomainSSLCollectorRequest):
    task = domain_ssl_collect_task.delay(domain=req.domain, report_email=req.report_email)
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/wp-outdated-fetch", response_model=TaskEnqueueResponse)
def trigger_wp_outdated_fetch(req: WPOutdatedFetchRequest):
    task = wp_outdated_fetch_task.delay(
        url=req.url,
        headers=req.headers,
        report_email=req.report_email,
        basic_auth=req.basic_auth,
        timeout=req.timeout or 15,
    )
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/wp-update/plugins", response_model=TaskEnqueueResponse, summary="Update WP plugins via REST")
def trigger_wp_update_plugins(req: WPUpdatePluginsRequest):
    task = wp_update_plugins_task.delay(
        base_url=req.base_url,
        plugins=req.plugins,
        auto_select_outdated=req.auto_select_outdated,
        blocklist=req.blocklist,
        auth=(req.auth.dict() if req.auth else None),
        headers=req.headers,
        report_email=req.report_email
    )
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/wp-update/core", response_model=TaskEnqueueResponse, summary="Update WP core via REST")
def trigger_wp_update_core(req: WPUpdateCoreRequest):
    task = wp_update_core_task.delay(
        base_url=req.base_url,
        precheck=req.precheck,
        auth=(req.auth.dict() if req.auth else None),
        headers=req.headers,
        report_email=req.report_email
    )
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/wp-update/all", response_model=TaskEnqueueResponse, summary="Update plugins + core in one click")
def trigger_wp_update_all(req: WPUpdateAllRequest):
    task = wp_update_all_task.delay(
        base_url=req.base_url,
        include_plugins=req.include_plugins,
        include_core=req.include_core,
        precheck_core=req.precheck_core,
        blocklist=req.blocklist,
        headers=req.headers,
        auth=(req.auth.dict() if req.auth else None),
        report_email=req.report_email,
    )
    return {"task_id": task.id, "status": "queued"}

@app.post("/tasks/backup/db")   # remove response_model so we can return FileResponse
def trigger_backup_db(
    req: BackupDbRequest = Body(embed=True),
    site: SiteConfig = Body(embed=True),
    background_tasks: BackgroundTasks = None
):
    site.user = "root"
    task = run_site_task.delay(
        site.dict(), "backup_db",
        db_name=site.db_name, db_user=site.db_user, db_pass=site.db_pass,
        out_dir=req.out_dir
    )

    # Normal async behavior (old style)
    if not req.download:
        return {"task_id": task.id, "status": "queued"}

    # One-click: wait for task, then download the file
    res = AsyncResult(task.id, app=celery)
    try:
        result = res.get(timeout=req.wait_timeout)
    except Exception as e:
        return JSONResponse({"task_id": task.id, "state": res.state, "error": f"timeout/wait failed: {e}"}, status_code=504)

    remote_path = (result or {}).get("db_dump")
    if not remote_path:
        return JSONResponse({"task_id": task.id, "state": res.state, "error": "no db_dump path returned", "result": result}, status_code=500)

    # Download over SSH to a temp file and stream it
    site_dict = _normalize_site(site.dict())
    key_created = bool(site_dict.get("private_key_pem"))
    key_path = _materialize_key(site_dict)
    params = _conn_params(site_dict)

    tmpdir = tempfile.mkdtemp(prefix="dl_")
    download_name = req.filename or os.path.basename(remote_path) or "database.sql.gz"
    local_path = os.path.join(tmpdir, download_name)

    try:
        with Connection(**params) as c:
            c.get(remote_path, local=local_path)
    finally:
        if key_created and key_path:
            try: os.remove(key_path)
            except Exception: pass

    background_tasks.add_task(shutil.rmtree, tmpdir, ignore_errors=True)
    return FileResponse(local_path, media_type="application/gzip", filename=download_name)


@app.post("/tasks/backup/content")  # remove response_model so we can return FileResponse
def trigger_backup_content(req: BackupDbRequest = Body(embed=True),
    site: SiteConfig = Body(embed=True),
    background_tasks: BackgroundTasks = None
):
    site.user = "root"
    task = run_site_task.delay(
        site.dict(), "backup_wp_content",
        wp_path=site.wp_path, out_dir=req.out_dir
    )

    if not req.download:
        return {"task_id": task.id, "status": "queued"}

    res = AsyncResult(task.id, app=celery)
    try:
        result = res.get(timeout=req.wait_timeout)
    except Exception as e:
        return JSONResponse({"task_id": task.id, "state": res.state, "error": f"timeout/wait failed: {e}"}, status_code=504)

    remote_path = (result or {}).get("content_tar")
    if not remote_path:
        return JSONResponse({"task_id": task.id, "state": res.state, "error": "no content_tar path returned", "result": result}, status_code=500)

    site_dict = _normalize_site(site.dict())
    key_created = bool(site_dict.get("private_key_pem"))
    key_path = _materialize_key(site_dict)
    params = _conn_params(site_dict)

    tmpdir = tempfile.mkdtemp(prefix="dl_")
    download_name = req.filename or os.path.basename(remote_path) or "wp-content.tar.gz"
    local_path = os.path.join(tmpdir, download_name)

    try:
        with Connection(**params) as c:
            c.get(remote_path, local=local_path)
    finally:
        if key_created and key_path:
            try: os.remove(key_path)
            except Exception: pass

    background_tasks.add_task(shutil.rmtree, tmpdir, ignore_errors=True)
    return FileResponse(local_path, media_type="application/gzip", filename=download_name)