from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, Field, EmailStr
from uuid import uuid4
from app.workers.tasks import provision_wordpress_task

router = APIRouter()

class ProvisionRequest(BaseModel):
    ssh_host: str = Field(..., example="192.168.1.100")
    ssh_user: str = Field(..., example="root")
    ssh_pass: str = Field(..., example="yourpassword")
    db_name: str = Field(..., example="wp_db")
    db_user: str = Field(..., example="wp_user")
    db_pass: str = Field(..., example="wp_pass")
    wp_admin_email: EmailStr = Field(..., example="admin@example.com")
    domain_name: str | None = Field(None, example="example.com")
    wp_site_title: str | None = Field("My WordPress Site")

class ProvisionResponse(BaseModel):
    status: str
    task_id: str
    message: str

@router.post("/provision", response_model=ProvisionResponse, tags=["Provisioning"])
def provision_server(payload: ProvisionRequest, background_tasks: BackgroundTasks):
    """
    Starts the WordPress provisioning process on a remote VPS via SSH.
    """
    try:
        task_id = str(uuid4())
        provision_wordpress_task.delay(task_id=task_id, payload=payload.dict())
        # background_tasks.add_task(provision_wordpress_task, task_id, payload.dict())
        return ProvisionResponse(
            status="provisioning_started",
            task_id=task_id,
            message=f"Provisioning started. A report will be sent to {payload.wp_admin_email}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Provisioning failed: {str(e)}"
        )
