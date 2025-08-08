import os
from app.utils.ssh_utils import ssh_connect, ssh_run_command, ssh_upload_file
from app.core.logger import setup_logger

logger = setup_logger("provision_service")

SCRIPT_NAME = "provision_wordpresss.sh"
LOCAL_SCRIPT_PATH = os.path.join(os.getcwd(), "app", SCRIPT_NAME)
REMOTE_SCRIPT_PATH = f"/root/{SCRIPT_NAME}"

def run_provision_script(
    ssh_host: str,
    ssh_user: str,
    ssh_pass: str,
    db_name: str,
    db_user: str,
    db_pass: str,
    wp_email: str,
    domain: str | None = None
) -> str:
    logger.info(f"Connecting to {ssh_host} as {ssh_user}...")
    client = ssh_connect(host=ssh_host, username=ssh_user, password=ssh_pass)
    
    try:
        logger.info("Uploading script...")
        ssh_upload_file(client, local_path=LOCAL_SCRIPT_PATH, remote_path=REMOTE_SCRIPT_PATH)

        logger.info("Making script executable...")
        ssh_run_command(client, f"chmod +x {REMOTE_SCRIPT_PATH}")

        logger.info("Running provisioning script...")
        command = f"{REMOTE_SCRIPT_PATH} {db_name} {db_user} {db_pass} {wp_email}"
        if domain:
            command += f" {domain}"

        output = ssh_run_command(client, command)
        logger.info("Provisioning complete.")
        return output
    finally:
        client.close()