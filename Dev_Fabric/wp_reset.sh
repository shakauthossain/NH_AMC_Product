#!/usr/bin/env bash
set -euo pipefail

# WordPress rollback (auto-detect) for Ubuntu + Nginx + MySQL + PHP
# - Finds wp-config.php -> gets DB name/user and WP path
# - Finds Nginx site serving that path
# - Confirms each destructive step (use --force to skip prompts)
# - Optional: purge stack (--purge-stack) and reset UFW (--reset-ufw)
#
# Usage:
#   rollback_wp.sh [-p WP_PATH] [-d DOMAIN] [-r REPORT_PATH] [--force] [--purge-stack] [--reset-ufw]
#
# Examples:
#   rollback_wp.sh --force
#   rollback_wp.sh -p /var/www/html -d example.com --purge-stack --reset-ufw --force

REPORT_PATH="/tmp/wp_rollback_report.json"
WP_PATH=""
DOMAIN=""
FORCE="false"
PURGE_STACK="false"
RESET_UFW="false"

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

confirm() {
  local prompt="$1"
  if [[ "$FORCE" == "true" ]]; then
    return 0
  fi
  read -r -p "$prompt (y/N): " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# ---- args ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--path) WP_PATH="${2:?}"; shift 2;;
    -d|--domain) DOMAIN="${2:?}"; shift 2;;
    -r|--report) REPORT_PATH="${2:?}"; shift 2;;
    --force) FORCE="true"; shift;;
    --purge-stack) PURGE_STACK="true"; shift;;
    --reset-ufw) RESET_UFW="true"; shift;;
    -h|--help)
      sed -n '1,60p' "$0"; exit 0;;
    *)
      echo "Unknown arg: $1"; exit 1;;
  esac
done

log "Starting WordPress rollback (auto-detect mode)"

# ---- detect wp-config / path ----
if [[ -z "${WP_PATH}" ]]; then
  log "Searching for wp-config.php under /var/www and /home ..."
  # Prefer match by domain if supplied
  if [[ -n "$DOMAIN" ]]; then
    CANDIDATES=$(sudo grep -rl --exclude-dir=wp-content "DB_NAME" /var/www /home 2>/dev/null | grep "wp-config.php" || true)
    # When DOMAIN given, try to find nginx site and check its root
    if [[ -d /etc/nginx/sites-enabled ]]; then
      SITE_FILE=$(grep -rl "$DOMAIN" /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)
      if [[ -n "$SITE_FILE" ]]; then
        ROOT_LINE=$(grep -E "^\s*root\s+" "$SITE_FILE" | head -n1 || true)
        ROOT_DIR=$(echo "$ROOT_LINE" | awk '{print $2}' | sed 's/;//')
        if [[ -n "$ROOT_DIR" && -f "$ROOT_DIR/wp-config.php" ]]; then
          WP_PATH="$ROOT_DIR"
        fi
      fi
    fi
    # fallback to first candidate path
    if [[ -z "$WP_PATH" && -n "$CANDIDATES" ]]; then
      WP_PATH=$(dirname "$(echo "$CANDIDATES" | head -n1)")
    fi
  else
    WP_PATH=$(dirname "$(sudo find /var/www /home -type f -name wp-config.php 2>/dev/null | head -n1 || true)")
  fi
fi

if [[ -z "${WP_PATH}" || ! -f "${WP_PATH}/wp-config.php" ]]; then
  echo "Error: Could not locate wp-config.php. Provide --path or ensure WordPress exists."
  exit 1
fi

log "Detected WordPress path: $WP_PATH"
WP_CONFIG="$WP_PATH/wp-config.php"

# ---- extract DB credentials from wp-config ----
DB_NAME=$(grep -E "define\(\s*'DB_NAME'" "$WP_CONFIG" | sed "s/.*'DB_NAME'\s*,\s*'\([^']*\)'.*/\1/")
DB_USER=$(grep -E "define\(\s*'DB_USER'" "$WP_CONFIG" | sed "s/.*'DB_USER'\s*,\s*'\([^']*\)'.*/\1/")

if [[ -z "$DB_NAME" || -z "$DB_USER" ]]; then
  echo "Error: Failed to parse DB_NAME/DB_USER from $WP_CONFIG"
  exit 1
fi
log "DB Name: $DB_NAME"
log "DB User: $DB_USER"

# ---- detect nginx site file ----
NGINX_SITE_FILE=""
if [[ -d /etc/nginx/sites-enabled ]]; then
  # Try by root path first
  NGINX_SITE_FILE=$(grep -rl "$WP_PATH" /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)
  # Try by domain if not found
  if [[ -z "$NGINX_SITE_FILE" && -n "$DOMAIN" ]]; then
    NGINX_SITE_FILE=$(grep -rl "$DOMAIN" /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)
  fi
fi
NGINX_SITE_NAME=""
if [[ -n "$NGINX_SITE_FILE" ]]; then
  NGINX_SITE_NAME=$(basename "$NGINX_SITE_FILE")
  log "Detected Nginx site: $NGINX_SITE_NAME"
else
  log "No Nginx site linked found (skipping site removal step unless you choose purge stack)."
fi

# ---- stop services (optional) ----
if confirm "Stop Nginx, MySQL, and PHP-FPM services now?"; then
  systemctl stop nginx mysql || true
  systemctl stop "$(systemctl list-units --type=service | awk '/php.*-fpm\.service/ {print $1}')" || true
  log "Services stopped."
fi

# ---- remove WordPress files ----
if confirm "Remove WordPress files at '$WP_PATH'?"; then
  rm -rf "$WP_PATH"
  log "WordPress files removed."
fi

# ---- drop DB and user (socket auth; no root pw) ----
if confirm "Drop MySQL database '$DB_NAME' and user '$DB_USER'@'localhost'?"; then
  mysql -e "DROP DATABASE IF EXISTS \`$DB_NAME\`;"
  mysql -e "DROP USER IF EXISTS '$DB_USER'@'localhost'; FLUSH PRIVILEGES;"
  log "Database and user removed."
fi

# ---- remove nginx site ----
if [[ -n "$NGINX_SITE_NAME" ]]; then
  if confirm "Remove Nginx site config '$NGINX_SITE_NAME' (from sites-available & sites-enabled) and reload Nginx?"; then
    rm -f "/etc/nginx/sites-enabled/$NGINX_SITE_NAME" || true
    rm -f "/etc/nginx/sites-available/$NGINX_SITE_NAME" || true
    if nginx -t; then systemctl reload nginx; fi
    log "Nginx site removed and Nginx reloaded."
  fi
fi

# ---- optional: purge stack ----
if [[ "$PURGE_STACK" == "true" ]]; then
  if confirm "Purge Nginx, MySQL, PHP* packages and remove configs (/etc/nginx,/etc/mysql,/etc/php)?"; then
    apt-get purge -y nginx nginx-common nginx-core mysql-server mysql-common "php*" ufw unzip wget curl || true
    apt-get autoremove -y || true
    apt-get autoclean -y || true
    systemctl disable nginx mysql >/dev/null 2>&1 || true
    # Remove leftover configs
    rm -rf /etc/nginx /etc/mysql /etc/php || true
    log "LEMP stack purged."
  fi
fi

# ---- optional: reset UFW ----
if [[ "$RESET_UFW" == "true" ]]; then
  if command -v ufw >/dev/null 2>&1; then
    if confirm "Reset UFW firewall rules?"; then
      ufw --force reset || true
      log "UFW reset."
    fi
  fi
fi

# ---- write report ----
cat > "$REPORT_PATH" <<JSON
{
  "status": "rolled_back",
  "wp_path": "$WP_PATH",
  "db_name": "$DB_NAME",
  "db_user": "$DB_USER",
  "nginx_site": "$NGINX_SITE_NAME",
  "purged_stack": "$PURGE_STACK",
  "reset_ufw": "$RESET_UFW",
  "forced": "$FORCE"
}
JSON

echo "$REPORT_PATH"