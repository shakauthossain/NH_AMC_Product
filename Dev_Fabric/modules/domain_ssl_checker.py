# modules/domain_ssl_checker.py
from __future__ import annotations

import socket, ssl, json
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ---------- helpers ----------
def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)

def _fmt(dt: datetime | None) -> str:
    dt = _ensure_utc(dt)
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else ""

def _parse_iso(s: str) -> datetime | None:
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except Exception:
        return None

def _parse_loose_date(s: str) -> datetime | None:
    s = s.strip()
    fmts = [
        "%Y-%m-%dT%H:%M:%S%z",  # 2026-02-10T00:00:00+00:00
        "%Y-%m-%dT%H:%M:%SZ",   # 2026-02-10T00:00:00Z
        "%Y-%m-%d",             # 2026-02-10
        "%d-%b-%Y",             # 10-Feb-2026
        "%b %d %H:%M:%S %Y %Z", # Oct 24 22:14:28 2025 GMT
    ]
    dt = _parse_iso(s)
    if dt: return dt
    for f in fmts:
        try: return datetime.strptime(s, f)
        except Exception: pass
    return None

# ---------- DOMAIN EXPIRY (RDAP-only, stdlib) ----------
def get_domain_expiry(domain: str):
    """
    Returns:
      - success: "YYYY-MM-DD HH:MM:SS" (UTC)  [exact format your task expects]
      - failure: "WHOIS error: <reason>"
    """
    try:
        req = Request(f"https://rdap.org/domain/{domain}", headers={"User-Agent": "nh-amc/1.0"})
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        exp = None
        for ev in data.get("events", []):
            if ev.get("eventAction") in ("expiration", "expires", "expiry"):
                exp = _parse_iso(ev.get("eventDate", ""))
                if exp: break
        if exp:
            return _fmt(exp)
        return "WHOIS error: RDAP had no expiration event"
    except (HTTPError, URLError, TimeoutError, ssl.SSLError, ValueError) as e:
        return f"WHOIS error: RDAP request failed ({e})"

# ---------- SSL EXPIRY (unchanged, stdlib) ----------
def get_ssl_expiry(domain: str):
    """
    Returns:
      - success: datetime (parsed from certificate notAfter)
      - failure: "SSL error: <reason>"
    """
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
        # Example notAfter: 'Oct 24 22:14:28 2025 GMT'
        not_after = _parse_loose_date(cert.get("notAfter", ""))
        if not_after is None:
            return "SSL error: unrecognized notAfter"
        return not_after
    except Exception as e:
        return f"SSL error: {e}"
