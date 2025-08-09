from pydantic import BaseModel, Field
from typing import Optional, Literal

class ResetRequest(BaseModel):
    host: str = Field(..., description="Droplet IP or hostname")
    ssh_user: str = "root"
    ssh_port: int = 22
    auth_type: Literal["key", "password"] = "key"
    private_key: Optional[str] = None  # if you already support key lookup by name, reuse
    password: Optional[str] = None
    dry_run: bool = True
    force: bool = False
    confirm_text: str = Field(..., description='Must be exactly "RESET" to proceed')
    approval_token: str = Field(..., description="Short-lived server-side issued token")
    pre_snapshot: bool = False
    provider: Optional[Literal["digitalocean","aws","gcp"]] = None
    snapshot_id: Optional[str] = None  # for restore mode
    mode: Literal["cleanup","snapshot_restore"] = "cleanup"

class ResetResponse(BaseModel):
    task_id: str
    message: str