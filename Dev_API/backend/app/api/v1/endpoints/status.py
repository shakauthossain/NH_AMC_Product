from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.db.models.task_log import TaskLog
from app.db.session import get_session

router = APIRouter()

class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    output: str | None

@router.get("/status/{task_id}", response_model=TaskStatusResponse, tags=["Status"])
def get_task_status(task_id: str, db: Session = Depends(get_session)):
    task = db.query(TaskLog).filter(TaskLog.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskStatusResponse(task_id=task.task_id, status=task.status, output=task.output)