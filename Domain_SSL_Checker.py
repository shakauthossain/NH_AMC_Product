import whois
import ssl
import socket
from datetime import datetime
from ipwhois import IPWhois

def get_domain_expiry(domain):
    try:
        w = whois.whois(domain)
        expire = w.expiration_date
        expiration = [exp.strftime("%Y-%m-%d %H:%M:%S") for exp in expire]
        return max(expiration)
    except Exception as e:
        return f"WHOIS error: {e}"

def get_ssl_expiry(domain):
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                return datetime.strptime(cert['notAfter'], '%b %d %H:%M:%S %Y %Z')
    except Exception as e:
        return f"SSL error: {e}"


def check_domain(domain):
    print(f"Checking: {domain}")
    print("-" * 40)

    domain_expiry = get_domain_expiry(domain)
    ssl_expiry = get_ssl_expiry(domain)

    print(f"Domain Expiry: {domain_expiry}")
    print(f"SSL Expiry:    {ssl_expiry}")

# Example
check_domain("notionhive.com")
