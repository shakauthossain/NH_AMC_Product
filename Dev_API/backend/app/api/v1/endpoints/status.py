from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session
from app.db.models.task_log import TaskLog
from app.db.session import get_session
from pydantic import BaseModel

router = APIRouter()

class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    output: str | None

@router.get("/status/{task_id}", response_model=TaskStatusResponse, tags=["Status"])
def get_task_status(task_id: str):
    """
    Check the provisioning status by task ID.
    """
    db: Session = get_session()
    task = db.query(TaskLog).filter(TaskLog.task_id == task_id).first()
    db.close()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return TaskStatusResponse(
        task_id=task.task_id,
        status=task.status,
        output=task.output
    )
