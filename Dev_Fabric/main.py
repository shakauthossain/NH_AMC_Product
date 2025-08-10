from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from celery.result import AsyncResult
from celery_app import run_site_task, celery
from schemas import SiteConfig, SSLCheckRequest, HealthcheckRequest, TaskEnqueueResponse, TaskResultResponse, WPInstallRequest, SiteConnection, SiteIdResponse, WPInstallRequest, TaskEnqueueResponse, TaskResultResponse, WPResetRequest
from logger import get_logger
from task_runner import verify_ssh
from config import settings
import uuid

app = FastAPI(title="NH AMC MVP")
log = get_logger("api")
SITES: dict[str, dict] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,             # set True only if you need cookies
    allow_methods=["*"],                 # or list specific: ["GET","POST","OPTIONS"]
    allow_headers=["*"],                 # include "Authorization" etc.
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
def trigger_wp_reset(req: WPResetRequest, site: SiteConfig, _ok: bool = Depends(require_reset_token)):
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

