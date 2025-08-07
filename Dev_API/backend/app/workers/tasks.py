from celery import Celery
from app.services.provision_service import run_provision_script
from app.services.email_service import send_provisioning_report
from app.db.models.task_log import TaskLog
from app.db.session import get_session
from sqlalchemy.orm import Session
from datetime import datetime

celery_app = Celery(
    "tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/0"
)

@celery_app.task(name="provision_wordpress_task")
def provision_wordpress_task(task_id: str, payload: dict):
    """
    Task to provision a WordPress site on a remote VPS using SSH.
    Tracks status and output in the database.
    """
    db: Session = get_session()
    try:
        # Create initial task record
        task_log = TaskLog(task_id=task_id, status="in_progress")
        db.add(task_log)
        db.commit()

        ssh_host = payload["ssh_host"]
        ssh_user = payload["ssh_user"]
        ssh_pass = payload["ssh_pass"]
        db_name = payload["db_name"]
        db_user = payload["db_user"]
        db_pass = payload["db_pass"]
        wp_email = payload["wp_admin_email"]
        domain = payload.get("domain_name")

        output = run_provision_script(
            ssh_host=ssh_host,
            ssh_user=ssh_user,
            ssh_pass=ssh_pass,
            db_name=db_name,
            db_user=db_user,
            db_pass=db_pass,
            wp_email=wp_email,
            domain=domain
        )

        send_provisioning_report(
            to_email=wp_email,
            server_ip=ssh_host,
            domain=domain,
            output=output
        )

        task_log.status = "completed"
        task_log.output = output

    except Exception as e:
        task_log.status = "failed"
        task_log.output = str(e)
        print(f"[ERROR] Task {task_id} failed: {str(e)}")

    finally:
        db.add(task_log)
        db.commit()
        db.close()
