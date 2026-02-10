# WordPress Site Setup Guide

This guide covers everything that needs to be configured on each **WordPress site** managed by the NH AMC platform.

> **✅ Everything is fully automated.** The provisioning script (`wp_provision.sh`) handles all setup steps automatically, including Application Password creation and MU plugin installation.

---

## Fully Automated Setup

The provision script handles **every** required configuration step:

| Setup Item                           | How It's Done                                    |
| ------------------------------------ | ------------------------------------------------ |
| LEMP Stack (Nginx, MySQL, PHP-FPM)   | Auto-installed with fallback versions            |
| WP-CLI installation                  | Downloaded from official source                  |
| WordPress core download & install    | Headless install with retries                    |
| `wp-config.php` constants            | Injected before "stop editing" line              |
| Nginx timeout + auth headers         | Patched into site config (600s timeout)          |
| PHP-FPM timeout                      | Custom pool file `zz-plugin-updates.conf`        |
| File permissions (`www-data`)        | Applied twice (pre & post WordPress install)     |
| Permalink structure (`/%postname%/`) | Set via WP-CLI                                   |
| Remote Plugin Updater plugin         | Cloned from GitHub and activated                 |
| Basic Auth plugin                    | Cloned from WP-API GitHub and activated          |
| NH Upgrader Safety Net (MU plugin)   | Embedded inline into `wp-content/mu-plugins/`    |
| Application Password                 | Created via WP-CLI, included in provision report |
| Let's Encrypt SSL                    | Auto-issued if domain + email provided           |
| UFW firewall rules                   | Configured for SSH + Nginx                       |

### Application Password in Provision Report

After provisioning, the **generated Application Password** is included in the JSON report at `/tmp/wp_provision_report.json`:

```json
{
  "admin_user": "admin",
  "app_password": "xxxx xxxx xxxx xxxx xxxx xxxx",
  "mu_safety_net": "installed",
  ...
}
```

Use the `admin_user` and `app_password` values in the NH AMC dashboard **Settings** page to connect to the site.

> **Note:** If `app_password` shows `"already_exists"`, an Application Password named "NH AMC" was previously created. You'll need the original password or can create a new one manually from WP Admin → Users → Profile.

---

## What the Provision Script Does (Reference)

Below is a detailed breakdown of everything the provision script handles. This is documented for reference and troubleshooting.

### LEMP Stack Installation

The script installs and configures the full stack:

- **Nginx** — Web server with WordPress-optimized vhost config
- **MySQL** — Database server with auto-created DB, user, and grants
- **PHP-FPM** — With extensions: `mysql`, `xml`, `curl`, `zip`, `gd`, `mbstring`, `intl`
- **WP-CLI** — WordPress command-line interface

### wp-config.php Constants

These constants are automatically added above the `/* That's all, stop editing! */` line:

```php
define('REST_AUTHORIZATION_HEADER', true);   // Allow REST API auth headers
define('FS_METHOD', 'direct');               // Direct filesystem access for updates
define('WP_MEMORY_LIMIT', '512M');           // Memory for WP operations
define('DISALLOW_FILE_MODS', false);         // Allow plugin/core updates via API
define('WP_MAX_MEMORY_LIMIT', '512M');       // Admin memory limit
```

### Server Timeout Configuration

#### Nginx (`/etc/nginx/sites-available/<site>`)

The script injects into the PHP location block:

```nginx
fastcgi_param HTTP_AUTHORIZATION $http_authorization;  # Forward auth headers
fastcgi_read_timeout 600s;
fastcgi_send_timeout 600s;
```

It also adds global timeouts to `/etc/nginx/nginx.conf`:

```nginx
proxy_read_timeout 300s;
proxy_connect_timeout 300s;
fastcgi_read_timeout 300s;
fastcgi_send_timeout 300s;
fastcgi_connect_timeout 300s;
```

#### PHP-FPM

Creates `/etc/php/<version>/fpm/pool.d/zz-plugin-updates.conf`:

```ini
request_terminate_timeout = 600s
pm.max_requests = 500
```

Also updates `php.ini`:

```ini
memory_limit = 512M
max_execution_time = 600
post_max_size = 128M
upload_max_filesize = 128M
```

### Custom Plugin Installation

The provision script installs these plugins automatically:

1. **Remote Plugin Updater** — Cloned from `shakauthossain/remote-plugins-updater` GitHub
   - Endpoint: `GET /wp-json/custom/v1/status` — Returns core, plugin, theme status
   - Endpoint: `POST /wp-json/custom/v1/update-plugins` — Triggers updates with backup/rollback

2. **Basic Auth** — Cloned from `WP-API/Basic-Auth` GitHub
   - Enables HTTP Basic Auth for the WordPress REST API

3. **JSON Basic Authentication** — Installed from wordpress.org via WP-CLI

### NH Upgrader Safety Net (MU Plugin)

The provision script **embeds the full PHP source** inline and writes it to `wp-content/mu-plugins/nh-upgrader-safetynet.php`. It then:

- Sets correct ownership (`www-data:www-data`)
- Validates PHP syntax with `php -l`
- Removes the file if syntax validation fails

**What the MU plugin does:**

- Hooks into `upgrader_pre_install` to back up plugin folders before updates
- Hooks into `upgrader_install_package_result` to auto-restore on failure
- Increases HTTP timeout to 300s and raises memory limits during updates
- Backups stored in `wp-content/upgrade/plugin-backups/`

### Application Password

The provision script creates an Application Password using WP-CLI:

```bash
wp user application-password create "$ADMIN_USER" "NH AMC" --porcelain
```

- **Idempotent:** Checks if "NH AMC" already exists before creating
- **Included in report:** The generated password appears in the JSON provision report
- **Naming:** Always named "NH AMC" for easy identification in WP Admin

### WordPress Post-Install Configuration

- **Permalinks** set to `/%postname%/` (required for REST API routes)
- **Blog visibility** set to private (`blog_public = 0`)
- **Language** configured based on `LOCALE` parameter
- **Rewrite rules** flushed and hardened
- **Info page** created with site details

### File Permissions

Applied twice (before and after WordPress install):

```bash
chown -R www-data:www-data /var/www/html
find /var/www/html -type d -exec chmod 755 {} \;
find /var/www/html -type f -exec chmod 644 {} \;
```

### Let's Encrypt SSL (If Domain Provided)

If a domain and email are provided during provisioning:

- Certbot is installed
- SSL certificate is issued for the domain
- Nginx is configured for HTTPS redirect
- WordPress URLs are updated to HTTPS

---

## REST API Endpoints (Quick Reference)

After provisioning, these endpoints are available on each managed site:

| Endpoint                            | Method | Auth       | Description                        |
| ----------------------------------- | ------ | ---------- | ---------------------------------- |
| `/wp-json/custom/v1/status`         | GET    | Basic Auth | Full status: core, plugins, themes |
| `/wp-json/custom/v1/update-plugins` | POST   | Basic Auth | Trigger plugin updates             |

### Testing After Provision

```bash
# Test status endpoint (use app_password from provision report)
curl -u "admin:app-password" https://your-site.com/wp-json/custom/v1/status | jq .

# Dry-run a plugin update
curl -X POST \
  -u "admin:app-password" \
  -H "Content-Type: application/json" \
  -d '{"plugins": ["akismet"], "dry_run": true}' \
  https://your-site.com/wp-json/custom/v1/update-plugins | jq .
```

---

## Troubleshooting

### REST API returns 401 Unauthorized

- Ensure the **Basic Auth** plugin is active: `wp plugin list --status=active`
- Verify Application Password was created: `wp user application-password list admin`
- Check that `REST_AUTHORIZATION_HEADER` is defined in `wp-config.php`
- Confirm Nginx forwards auth headers: `grep HTTP_AUTHORIZATION /etc/nginx/sites-available/*`

### REST API returns 404

- Permalinks must be set to **Post name**, not Plain
- Flush rewrite rules: `wp rewrite flush --hard`
- Verify the Remote Plugin Updater plugin is active: `wp plugin list | grep remote`

### Plugin updates timing out

- Check PHP-FPM timeout: `cat /etc/php/*/fpm/pool.d/zz-plugin-updates.conf`
- Check Nginx timeout: `grep fastcgi_read_timeout /etc/nginx/sites-available/*`
- Restart services: `systemctl restart php*-fpm nginx`

### Permission denied errors during updates

- Re-apply permissions:
  ```bash
  chown -R www-data:www-data /var/www/html
  find /var/www/html -type d -exec chmod 755 {} \;
  find /var/www/html -type f -exec chmod 644 {} \;
  ```
- Verify `FS_METHOD` is set: `grep FS_METHOD /var/www/html/wp-config.php`

### Application Password not working

- Requires WordPress 5.6+ and HTTPS (or localhost)
- Check if the password exists: `wp user application-password list admin`
- Create a new one if needed: `wp user application-password create admin "NH AMC" --porcelain`
