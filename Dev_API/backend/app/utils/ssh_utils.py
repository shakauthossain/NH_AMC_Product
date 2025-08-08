import paramiko
import time


def ssh_connect(host: str, username: str, password: str) -> paramiko.SSHClient:
    """
    Establish SSH connection and return the client.
    """
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host,
        username=username,
        password=password,
        timeout=15,
        auth_timeout=15,
        banner_timeout=15,
    )
    return client


def ssh_run_command(client: paramiko.SSHClient, command: str) -> str:
    """
    Run a command on the remote server and return output.
    """
    stdin, stdout, stderr = client.exec_command(command)
    stdout.channel.recv_exit_status()  # Wait for command to complete
    output = stdout.read().decode().strip()
    errors = stderr.read().decode().strip()
    return output + ("\n" + errors if errors else "")


def ssh_upload_file(client: paramiko.SSHClient, local_path: str, remote_path: str):
    """
    Upload a local file to the remote server.
    """
    ftp_client = client.open_sftp()
    ftp_client.put(local_path, remote_path)
    ftp_client.close()
