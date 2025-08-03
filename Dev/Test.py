import requests
import time
import schedule
import socket
import ssl
import hashlib
import os
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from datetime import datetime
from PIL import Image
import imagehash
from io import BytesIO

# === CONFIGURATION ===
WEBSITE_URL = "https://notionhive.com"
EXPECTED_KEYWORD = "Welcome"
CHECK_INTERVAL = 1
RESPONSE_TIME_THRESHOLD = 3
ALLOWED_DOMAINS = ["notionhive.com"]
BASELINE_HASH_FILE = "baseline_hash.txt"
SCREENSHOT_BASELINE = "baseline_screenshot.png"
SCREENSHOT_CURRENT = "current_screenshot.png"
PHANTOMJSCLOUD_API_KEY = "ak-ckgvm-rt07j-8fpjm-k5y33-w3cyc"

# === HEADERS ===
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": "https://google.com"
}

# === SUPPORT FUNCTIONS ===
def hash_content(html: str):
    return hashlib.sha256(html.encode()).hexdigest()

def load_or_create_baseline(html):
    if not os.path.exists(BASELINE_HASH_FILE):
        with open(BASELINE_HASH_FILE, "w") as f:
            f.write(hash_content(html))
        print("📦 Baseline hash saved.")
        return hash_content(html)
    with open(BASELINE_HASH_FILE, "r") as f:
        return f.read().strip()

def scan_for_threats(html):
    red_flags = [
        "hacked by", "defaced", "shell", "rooted",
        "<iframe", "eval(", "atob(", "Base64", "bitcoin",
        "document.write(unescape", "onerror=", "malware", "phish"
    ]
    found = False
    for flag in red_flags:
        if flag.lower() in html.lower():
            print(f"❗ Suspicious content detected: '{flag}'")
            found = True
    return found

def find_unexpected_links(html, allowed_domains):
    soup = BeautifulSoup(html, "html.parser")
    links = soup.find_all("a", href=True)
    for link in links:
        href = link["href"]
        domain = urlparse(href).netloc
        if domain and all(allowed not in domain for allowed in allowed_domains):
            print(f"⚠️ Unexpected external link: {href}")

def check_dns():
    try:
        host = urlparse(WEBSITE_URL).netloc
        ip = socket.gethostbyname(host)
        print(f"🌐 DNS resolved: {host} → {ip}")
        return True
    except Exception as e:
        print(f"❌ DNS resolution failed: {e}")
        return False

def check_ssl():
    try:
        host = urlparse(WEBSITE_URL).netloc
        context = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
                expire_date = datetime.strptime(cert['notAfter'], "%b %d %H:%M:%S %Y %Z")
                days_left = (expire_date - datetime.utcnow()).days
                print(f"🔒 SSL valid, expires in {days_left} days")
                if days_left < 15:
                    print("⚠️ SSL certificate expiring soon!")
        return True
    except Exception as e:
        print(f"❌ SSL check failed: {e}")
        return False

def check_suspicious_endpoints():
    suspicious_paths = [
        "/shell.php", "/adminer.php", "/phpinfo.php", "/wp-content/uploads/malicious.js"
    ]
    for path in suspicious_paths:
        try:
            url = WEBSITE_URL.rstrip("/") + path
            res = requests.get(url, headers=DEFAULT_HEADERS, timeout=5)
            if res.status_code == 200:
                print(f"❗ Suspicious file accessible: {url}")
        except:
            continue

def download_screenshot_phantomjscloud(url, output_path):
    api_url = (
        f"https://phantomjscloud.com/api/browser/v2/{PHANTOMJSCLOUD_API_KEY}/"
        f"?request={{\"url\":\"{url}\",\"renderType\":\"png\",\"waitFor\":\"loadEventEnd\",\"screenshotDelay\":10000,\"scrollToBottom\":true}}"
    )
    try:
        res = requests.get(api_url)
        if res.status_code == 200:
            with open(output_path, 'wb') as f:
                f.write(res.content)
            return True
        else:
            print(f"❌ Screenshot fetch failed: {res.status_code}")
            return False
    except Exception as e:
        print(f"❌ Screenshot fetch error: {e}")
        return False
    except Exception as e:
        print(f"❌ Screenshot fetch error: {e}")
        return False
    except Exception as e:
        print(f"❌ Screenshot fetch error: {e}")
        return False
    except Exception as e:
        print(f"❌ Screenshot fetch error: {e}")
        return False

def compare_screenshots():
    if not os.path.exists(SCREENSHOT_BASELINE):
        os.rename(SCREENSHOT_CURRENT, SCREENSHOT_BASELINE)
        print("📷 Baseline screenshot saved.")
        return False
    hash1 = imagehash.average_hash(Image.open(SCREENSHOT_BASELINE))
    hash2 = imagehash.average_hash(Image.open(SCREENSHOT_CURRENT))
    diff = hash1 - hash2
    print(f"🖼️ Screenshot difference hash: {diff}")
    return diff > 10

# === MAIN CHECK ===
def check_website():
    print(f"\n[{time.ctime()}] Checking {WEBSITE_URL}")
    dns_ok = check_dns()
    ssl_ok = check_ssl()

    try:
        start = time.time()
        response = requests.get(WEBSITE_URL, headers=DEFAULT_HEADERS, timeout=10)
        duration = round(time.time() - start, 2)

        if response.status_code == 200:
            print(f"✅ Site is UP. Response time: {duration}s")
            html = response.text
        elif response.status_code == 403:
            print("🚫 Site is UP but access is restricted (403 Forbidden) — skipping content checks.")
            html = response.text
        else:
            print(f"❌ Unexpected HTTP status: {response.status_code}")
            return

        if duration > RESPONSE_TIME_THRESHOLD:
            print(f"⚠️ Site is slow (> {RESPONSE_TIME_THRESHOLD}s)")

        if EXPECTED_KEYWORD.lower() in html.lower():
            print(f"🧠 Keyword '{EXPECTED_KEYWORD}' found.")
        else:
            print("❗ Expected keyword missing — page might have changed.")

        baseline_hash = load_or_create_baseline(html)
        current_hash = hash_content(html)
        if current_hash != baseline_hash:
            print("⚠️ Page hash mismatch — possible defacement!")

        scan_for_threats(html)
        find_unexpected_links(html, ALLOWED_DOMAINS)
        check_suspicious_endpoints()

        if download_screenshot_phantomjscloud(WEBSITE_URL, SCREENSHOT_CURRENT):
            if compare_screenshots():
                print("⚠️ Visual defacement detected based on screenshot!")

    except Exception as e:
        print(f"❌ Website check failed: {e}")

# === SCHEDULER ===
schedule.every(CHECK_INTERVAL).minutes.do(check_website)

print(f"🔍 Monitoring started for {WEBSITE_URL} every {CHECK_INTERVAL} minutes.\n")
check_website()  # Initial run

while True:
    schedule.run_pending()
    time.sleep(1)
