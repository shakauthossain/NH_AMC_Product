from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class SiteConfig(BaseModel):
    host: str
    user: str
    key_filename: Optional[str] = None
    private_key_pem: Optional[str] = None
    password: Optional[str] = None
    sudo_password: Optional[str] = None   # NEW
    wp_path: str
    db_name: str
    db_user: str
    db_pass: str
    port: Optional[int] = 22

class SSLCheckRequest(BaseModel):
    domain: str

class HealthcheckRequest(BaseModel):
    url: str
    keyword: Optional[str] = None
    screenshot: bool = False
    out_path: Optional[str] = "/tmp/site.png"

class WPStatusResponse(BaseModel):
    core: List[dict] = Field(default_factory=list)
    plugins: List[dict] = Field(default_factory=list)
    themes: List[dict] = Field(default_factory=list)
    
class SiteConnection(BaseModel):
    host: Optional[str] = None
    user: str
    key_filename: Optional[str] = None
    private_key_pem: Optional[str] = None
    password: Optional[str] = None
    wp_path: str = "/var/www/html"
    port: Optional[int] = 22

class SiteIdResponse(BaseModel):
    site_id: str
    verified: bool

class WPInstallRequest(BaseModel):
    domain: str
    wp_path: str = "/var/www/html"
    site_title: str
    admin_user: str
    admin_pass: str
    admin_email: str
    db_name: str
    db_user: str
    db_pass: str
    php_version: str = "8.1"
    wp_version: str = "latest"
    report_email: Optional[str] = None

class TaskEnqueueResponse(BaseModel):
    task_id: str
    status: str = "queued"

class TaskResultResponse(BaseModel):
    task_id: str
    state: str
    result: Optional[Dict[str, Any]] = None
    info: Optional[Any] = None
    
class WPResetRequest(BaseModel):
    wp_path: Optional[str] = None
    domain: Optional[str] = None
    purge_stack: bool = True
    reset_ufw: bool = True
    force: bool = True
    report_path: Optional[str] = "/tmp/wp_rollback_report.json"

class DomainSSLCollectorRequest(BaseModel):
    domain: str
    report_email: Optional[str] = None

class WPOutdatedFetchRequest(BaseModel):
    url: str
    headers: Optional[dict] = None
    report_email: Optional[str] = None
    basic_auth: Optional[str] = None   # "user:pass"
    timeout: Optional[int] = 15


class BasicAuth(BaseModel):
    username: str
    password: str

class WPUpdatePluginsRequest(BaseModel):
    base_url: str
    # If empty AND auto_select_outdated=True, we’ll fetch status and compute from it.
    plugins: Optional[List[str]] = None
    auto_select_outdated: bool = True
    blocklist: Optional[List[str]] = None
    headers: Optional[Dict[str, str]] = None
    auth: Optional[BasicAuth] = None
    report_email: Optional[str] = None

class WPUpdateCoreRequest(BaseModel):
    base_url: str
    precheck: bool = True            # only update if status says an update is available
    headers: Optional[Dict[str, str]] = None
    auth: Optional[BasicAuth] = None
    report_email: Optional[str] = None

class WPUpdateAllRequest(BaseModel):
    base_url: str
    # Optional knobs — you can ignore these and just send base_url
    include_plugins: bool = True
    include_core: bool = True
    precheck_core: bool = True
    blocklist: Optional[List[str]] = None
    headers: Optional[Dict[str, str]] = None
    auth: Optional[BasicAuth] = None       # reuse BasicAuth from earlier, or define it if not present
    report_email: Optional[str] = None

class BackupDbRequest(BaseModel):
    out_dir: Optional[str] = "/tmp/backups"
    download: bool = False                 # NEW: stream file back if True
    filename: Optional[str] = None         # optional download name
    wait_timeout: int = 600                # max seconds to wait for Celery

class BackupContentRequest(BaseModel):
    out_dir: Optional[str] = "/tmp/backups"
    download: bool = False
    filename: Optional[str] = None
    wait_timeout: int = 600