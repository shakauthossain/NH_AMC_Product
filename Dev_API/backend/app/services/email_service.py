import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings
from app.core.logger import setup_logger

logger = setup_logger("email_service")


def send_provisioning_report(to_email: str, server_ip: str, domain: str | None, output: str):
    """
    Sends an email containing the WordPress provisioning report.
    """
    subject = "✅ WordPress Provisioning Complete"
    site_url = f"http://{domain or server_ip}"
    admin_url = f"{site_url}/wp-admin"

    body = f"""
Hello,

Your WordPress site has been successfully installed.

🔗 Site URL: {site_url}
🔐 Admin Login: {admin_url}

📋 Provisioning Output:
-----------------------
{output}

Thank you,
WordPress VPS Provisioner Bot
"""

    msg = MIMEMultipart()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASS)
            server.sendmail(settings.SMTP_FROM, to_email, msg.as_string())
            logger.info(f"Provisioning report sent to {to_email}")
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {str(e)}")
