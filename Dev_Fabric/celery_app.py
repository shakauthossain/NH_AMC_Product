from celery import Celery
from config import settings
from task_runner import run_fabric_task
from emailer import send_report_email
from logger import get_logger

celery = Celery(__name__, broker=str(settings.BROKER_URL), backend=str(settings.RESULT_BACKEND))
log = get_logger("worker")

@celery.task(bind=True)
def run_site_task(self, site_config: dict, task_name: str, report_email: str | None = None, **kwargs):
    safe_site = {k: v for k, v in site_config.items() if k not in {"password","sudo_password","private_key_pem","db_pass","key_filename"}}
    log.info(f"[task {self.request.id}] start {task_name} site={safe_site} args={kwargs}")
    result = run_fabric_task(site_config, task_name, **kwargs)
    log.info(f"[task {self.request.id}] done {task_name} -> {('ok' if result else 'empty')}")
    if report_email:
        try:
            send_report_email(report_email, f"[{settings.APP_NAME}] Task {task_name} completed", result or {})
        except Exception as e:
            # Don’t fail the task because of email
            result = {"_original": result, "_email_error": str(e)}
    return result