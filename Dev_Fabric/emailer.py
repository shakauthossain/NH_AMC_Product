import smtplib, ssl, json
from email.message import EmailMessage
from typing import Dict, Any
from config import settings

def send_report_email(to_email: str, subject: str, report: Dict[str, Any]):
    if not to_email:
        return
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    body = [
        "WordPress Provisioning Report",
        "",
        json.dumps(report, indent=2)
    ]
    # include quick creds if present
    if "admin_user" in report:
        body += ["", f"Admin User: {report['admin_user']}"]
    if "db_user" in report and "db_name" in report:
        body += [f"DB: {report['db_name']} / {report['db_user']}"]
    msg.set_content("\n".join(body))

    context = ssl.create_default_context()
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        if settings.SMTP_STARTTLS:
            server.starttls(context=context)
        if settings.SMTP_USER and settings.SMTP_PASS:
            server.login(settings.SMTP_USER, settings.SMTP_PASS)
        server.send_message(msg)