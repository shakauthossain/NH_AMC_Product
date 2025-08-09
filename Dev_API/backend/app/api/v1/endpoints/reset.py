from fastapi import APIRouter, HTTPException
from app.schemas.reset import ResetRequest, ResetResponse
from app.workers.tasks import reset_droplet_task
import os
import time
from app.core.config import settings
from app.services.reset_service import ResetService
from uuid import uuid4

SECRET_APPROVAL_TOKEN = os.getenv("APPROVAL_TOKEN", "dev-token")
use_celery = str(os.getenv("USE_CELERY", "true")).strip().lower() == "true"

router = APIRouter(prefix="/reset", tags=["reset"])

def _verify_token(token: str) -> bool:
    expected = settings.approval_token or "dev-token"
    return token == expected

@router.post("/", response_model=ResetResponse)
def reset_droplet(req: ResetRequest):
    if req.confirm_text != "RESET":
        raise HTTPException(status_code=400, detail='confirm_text must be "RESET"')
    if not _verify_token(req.approval_token):
        raise HTTPException(status_code=403, detail="Invalid or expired approval token")

    use_celery = str(os.getenv("USE_CELERY", "true")).strip().lower() == "true"

    if not use_celery:
        task_id = f"inline-{int(time.time())}"
        svc = ResetService()
        svc.execute(task_id, req.model_dump())
        return ResetResponse(task_id=task_id, message="Executed inline")

    # Only runs if USE_CELERY=true
    task = reset_droplet_task.apply_async(args=[req.model_dump()])
    return ResetResponse(task_id=task.id, message="Reset task queued")