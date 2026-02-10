# Dev — WordPress Maintenance Utility Scripts

Standalone Python scripts used during **development and prototyping** of NH AMC's WordPress maintenance capabilities. These scripts can be run independently against live WordPress sites for manual diagnostics, status checks, and update operations.

---

## Table of Contents

- [Scripts](#scripts)
  - [Domain_SSL_Checker.py](#domain_ssl_checkerpy)
  - [Outdate_Fetch.py](#outdate_fetchpy)
  - [Full_Update_System.py](#full_update_systempy)
  - [Post_Update.py](#post_updatepy)
  - [Test.py — Site Monitor](#testpy--site-monitor)
  - [Test1.py — Screenshot API Test](#test1py--screenshot-api-test)
  - [Up\&Running.py](#uprunningpy)
- [Directories](#directories)
- [Setup](#setup)
- [WordPress REST API Requirements](#wordpress-rest-api-requirements)

---

## Scripts

### Domain_SSL_Checker.py

Performs **WHOIS** and **SSL certificate** expiry checks for a given domain.

**What it does:**

- Queries WHOIS records for domain registration expiry date
- Connects to port 443 to read the SSL certificate expiry date
- Prints both dates to the console

**Dependencies:** `python-whois`, `ipwhois`

**Usage:**

```bash
python Domain_SSL_Checker.py
```

> Edit the `check_domain("notionhive.com")` call at the bottom of the file to check a different domain.

---

### Outdate_Fetch.py

Fetches the **WordPress status JSON** from a remote site's REST API and displays outdated plugins, themes, and core version.

**What it does:**

- Calls `GET /wp-json/site/v1/status` on the target server
- Displays all plugins with their update status (✅ up-to-date or ⬆️ update available)
- Shows theme update status
- Reports WordPress core version and available update
- Displays PHP and MySQL version info

**Usage:**

```bash
python Outdate_Fetch.py
```

> Edit the `URL` variable at the top to point to your WordPress site.

---

### Full_Update_System.py

An **interactive CLI** tool for updating WordPress plugins and core via the REST API.

**What it does:**

1. Fetches site status (plugins, themes, core, PHP/MySQL versions)
2. Displays a formatted overview of all components
3. Prompts the user to choose: **Update Core** or **Update Plugins**
4. For plugins: presents a selectable list (with blocklist support) — choose individual plugins or `all`
5. Sends update requests to the WordPress REST API endpoints

**Key features:**

- Plugin blocklist — prevent specific plugins from being updated
- Interactive plugin selection (comma-separated numbers or `all`)
- Uses WP Application Passwords for authentication

**REST API endpoints used:**

- `GET /wp-json/site/v1/status` — Fetch status
- `POST /wp-json/custom/v1/update-plugins` — Update plugins
- `POST /wp-json/custom/v1/update-core` — Update core

**Usage:**

```bash
python Full_Update_System.py
```

> Edit `BASE_URL`, `AUTH`, and `BLOCKLIST` at the top of the file to configure.

---

### Post_Update.py

A **post-update verification and selective update** tool. Similar to `Full_Update_System.py` but uses plugin slugs directly from the status response for more reliable identification.

**What it does:**

1. Fetches current WordPress status
2. Lists outdated plugins (excluding blocklisted ones)
3. Allows selection of specific plugins to update
4. Triggers updates and reports results

**Usage:**

```bash
python Post_Update.py
```

> Edit `STATUS_URL`, `UPDATE_URL`, `AUTH`, and `BLOCKLIST` at the top.

---

### Test.py — Site Monitor

A comprehensive **website security and uptime monitoring** script that runs on a schedule.

**What it checks (every run):**
| Check | Description |
| ------------------ | --------------------------------------------------------------- |
| DNS Resolution | Verifies the domain resolves to an IP address |
| SSL Certificate | Checks SSL validity and warns if expiring within 15 days |
| HTTP Status | Confirms the site responds with 200 OK |
| Response Time | Alerts if response time exceeds threshold (default: 3s) |
| Keyword Presence | Verifies an expected keyword exists in the page HTML |
| Content Hash | Detects page modifications by comparing SHA-256 hashes |
| Malware Scan | Scans for suspicious strings (iframes, eval, base64, etc.) |
| External Links | Flags unexpected external links not in the allowed domains list |
| Suspicious Files | Probes for common web shells and info-leak files |
| Visual Comparison | Takes screenshots via PhantomJSCloud and compares visual hashes |

**Scheduling:** Runs every `CHECK_INTERVAL` minutes (default: 1 minute) using the `schedule` library.

**Dependencies:** `requests`, `schedule`, `beautifulsoup4`, `Pillow`, `imagehash`

**Usage:**

```bash
python Test.py
```

> Configure `WEBSITE_URL`, `EXPECTED_KEYWORD`, `CHECK_INTERVAL`, `ALLOWED_DOMAINS`, and `PHANTOMJSCLOUD_API_KEY` at the top.

---

### Test1.py — Screenshot API Test

A minimal test script for the **PhantomJSCloud** screenshot API. Sends a POST request to capture a website screenshot in JPG format.

**Usage:**

```bash
python Test1.py
```

---

### Up\&Running.py

Reserved placeholder for a future uptime/availability checker. **Currently empty.**

---

## Directories

### `WP Changes/`

Reference WordPress configuration files and modifications:

| File            | Description                                      |
| --------------- | ------------------------------------------------ |
| `.htaccess`     | Sample Apache rewrite rules                      |
| `functions.php` | Custom WordPress theme function additions        |
| `wp-config.php` | Sample WordPress configuration                   |
| `db.txt`        | Database connection reference notes              |
| `Basic-Auth/`   | Basic authentication setup files for WP REST API |

### `plugins/`

Contains plugin data files used during development and testing (705 items).

---

## Setup

```bash
# Navigate to the Dev directory
cd Dev

# Create a virtual environment (recommended)
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r Requirements.txt

# For Test.py, install additional packages:
pip install schedule beautifulsoup4 Pillow imagehash
```

---

## WordPress REST API Requirements

Most scripts interact with WordPress sites through custom REST API endpoints. Your WordPress installation needs these custom endpoints registered:

| Endpoint                            | Method | Purpose                                        |
| ----------------------------------- | ------ | ---------------------------------------------- |
| `/wp-json/site/v1/status`           | GET    | Site status (plugins, themes, core, PHP/MySQL) |
| `/wp-json/custom/v1/update-plugins` | POST   | Trigger plugin updates                         |
| `/wp-json/custom/v1/update-core`    | POST   | Trigger WordPress core update                  |

**Authentication:** Scripts use WordPress Application Passwords (Basic Auth). Generate one from **WordPress Admin → Users → Application Passwords**.

> **Note:** These endpoints require a custom WordPress plugin (see the `plugins/` directory or `WP Changes/` for reference configurations).
