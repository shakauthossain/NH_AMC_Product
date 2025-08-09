import os
import time
import tempfile
from typing import Dict, Any

from app.db.session import SessionLocal
from app.db.models.task_log import TaskLog
from app.utils.ssh_utils import ssh_connect, ssh_run_command, ssh_upload_file


class ResetService:
    def execute(self, task_id: str, req: Dict[str, Any]):
        db = SessionLocal()
        try:
            self._log(db, task_id, "START", "Reset requested", req)

            if not req.get("force", False):
                self._log(db, task_id, "INFO", "Kill-switch wait 30s before destructive phase")
                time.sleep(30)

            # Locate the .sh file in the backend root
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            script_path = os.path.join(project_root, "app/provision_wordpress.sh")
            if not os.path.exists(script_path):
                raise FileNotFoundError(f"Script not found at {script_path}")

            # Temp copy for upload
            with open(script_path, "rb") as f:
                script_bytes = f.read()

            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp.write(script_bytes)
                tmp.flush()
                local_tmp = tmp.name

            # Connect via existing helper
            client = ssh_connect(
                host=req["host"],
                username=req.get("ssh_user", "root"),
                password=req.get("password"),
            )

            try:
                remote_script = f"/root/reset_wp_{int(time.time())}.sh"
                ssh_upload_file(client, local_tmp, remote_script)
                ssh_run_command(client, f"chmod +x {remote_script}")

                dry_run_env = "true" if req.get("dry_run", True) else "false"
                output = ssh_run_command(client, f"DRY_RUN={dry_run_env} sudo {remote_script}")

                self._log(db, task_id, "SUCCESS", "Cleanup completed", {"output": output})
                return {"mode": "cleanup", "output": output}

            finally:
                try:
                    client.close()
                except Exception:
                    pass
                try:
                    os.unlink(local_tmp)
                except Exception:
                    pass

        except Exception as e:
            self._log(db, task_id, "ERROR", str(e))
            raise
        finally:
            db.close()

    def _log(self, db, task_id, status, message, meta=None):
        db.add(TaskLog(task_id=task_id, status=status, message=message, meta=meta or {}))
        db.commit()