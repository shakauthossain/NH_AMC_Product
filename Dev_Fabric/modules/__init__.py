# modules/domain_ssl_checker.py
from __future__ import annotations

import socket
import ssl
from datetime import datetime

# --- helpers (only used internally for printing/demo) ---
def _pick_latest(expire):
    if expire is None:
        return None
    if isinstance(expire, (list, tuple)):
        only_dt = [d for d in expire if isinstance(d, datetime)]
        return max(only_dt) if only_dt else None
    return expire if isinstance(expire, datetime) else None

# --- your original-style functions ---

def get_domain_expiry(domain: str):
    """
    Return:
      - success: string like "YYYY-MM-DD HH:MM:SS"
      - failure: "WHOIS error: <message>"
    Mirrors your original snippet's behavior.
    """
    try:
        import whois  # requires python-whois
        w = whois.whois(domain)
        expire = _pick_latest(getattr(w, "expiration_date", None))
        if not expire:
            return "WHOIS error: expiration_date not found"
        # Keep your exact format
        return expire.strftime("%Y-%m-%d %H:%M:%S")
    except Exception as e:
        return f"WHOIS error: {e}"

def get_ssl_expiry(domain: str):
    """
    Return:
      - success: datetime object (naive, from strptime)
      - failure: "SSL error: <message>"
    Mirrors your original snippet's behavior.
    """
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                # Example: 'Oct 24 22:14:28 2025 GMT'
                return datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z")
    except Exception as e:
        return f"SSL error: {e}"

# Optional: keeps your demo callable intact
def check_domain(domain: str):
    print(f"Checking: {domain}")
    print("-" * 40)
    domain_expiry = get_domain_expiry(domain)
    ssl_expiry = get_ssl_expiry(domain)
    print(f"Domain Expiry: {domain_expiry}")
    print(f"SSL Expiry:    {ssl_expiry}")

if __name__ == "__main__":
    check_domain("notionhive.com")
