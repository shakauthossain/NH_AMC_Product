#!/usr/bin/env bash
set -euo pipefail

# droplet_reset_to_ssh_only.sh
# Reset Ubuntu droplet to a minimal "SSH-only" state, removing common web stack bits.
# Tested on Ubuntu 20.04/22.04/24.04.
#
# Usage:
#   sudo bash droplet_reset_to_ssh_only.sh [--force] [--no-ufw] [--no-reboot]
#
# Notes:
# - Keeps your current SSH session alive; do NOT close it until done.
# - UFW will be reset to allow only OpenSSH (unless --no-ufw).
# - MySQL/MariaDB data under /var/lib/mysql will be deleted.
# - Apache/Nginx/PHP configs & logs are removed.

FORCE="false"
DO_UFW="true"
DO_REBOOT="true"
REPORT_PATH="/tmp/droplet_reset_report.json"

log(){ echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }


confirm(){
  if [[ "$FORCE" == "true" ]]; then return 0; fi
  read -r -p "$1 (y/N): " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

require_root(){
  if [[ $EUID -ne 0 ]]; then
    echo "Please run as root (e.g. sudo)." >&2
    exit 1
  fi
}

# ---- args ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE="true"; shift;;
    --no-ufw) DO_UFW="false"; shift;;
    --no-reboot) DO_REBOOT="false"; shift;;
    -h|--help)
      sed -n '1,120p' "$0"; exit 0;;
    *)
      echo "Unknown arg: $1"; exit 1;;
  esac
done

require_root
log "Starting droplet reset to SSH-only state"

# ---- quick sanity message ----
log "This will PURGE Nginx/Apache, MySQL/MariaDB, PHP, Certbot and delete their data/configs."
log "It will NOT remove your user accounts or SSH."

if ! confirm "Proceed with destructive reset?"; then
  echo "Aborted."
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y || true

# ---- stop services if present ----
log "Stopping services (ignore errors if not installed)"
systemctl stop nginx || true
systemctl stop apache2 || true
systemctl stop mysql || true
systemctl stop mariadb || true
# stop any php-fpm units
mapfile -t PHP_FPM_UNITS < <(systemctl list-units --type=service --all | awk '/php.*-fpm\.service/ {print $1}')
for u in "${PHP_FPM_UNITS[@]:-}"; do systemctl stop "$u" || true; done
systemctl stop redis-server || true
systemctl stop memcached || true
systemctl stop varnish || true

# ---- disable services ----
log "Disabling services"
systemctl disable nginx apache2 mysql mariadb redis-server memcached varnish >/dev/null 2>&1 || true
for u in "${PHP_FPM_UNITS[@]:-}"; do systemctl disable "$u" >/dev/null 2>&1 || true; done

# ---- purge packages ----
log "Purging packages (may take a bit)"
apt-get purge -y \
  nginx nginx-common nginx-core \
  apache2 apache2-bin apache2-data apache2-utils \
  mysql-server mysql-client mysql-common mariadb-server mariadb-client mariadb-common \
  "php*" \
  certbot python3-certbot* \
  redis-server memcached varnish || true

apt-get autoremove -y || true
apt-get autoclean -y || true

# ---- remove residual config/data/logs ----
log "Removing residual directories"
rm -rf \
  /etc/nginx /var/log/nginx /var/cache/nginx \
  /etc/apache2 /var/log/apache2 \
  /etc/mysql /var/lib/mysql /var/log/mysql \
  /etc/php /var/lib/php /var/log/php* \
  /etc/letsencrypt /var/log/letsencrypt \
  /var/www \
  /etc/redis /var/lib/redis /var/log/redis \
  /etc/memcached.conf /var/log/memcached \
  /etc/varnish /var/lib/varnish /var/log/varnish || true

# ---- make sure OpenSSH is good to go ----
log "Ensuring OpenSSH Server is installed and enabled"
apt-get install -y --no-install-recommends openssh-server
systemctl enable --now ssh >/dev/null 2>&1 || systemctl enable --now sshd >/dev/null 2>&1 || true

# ---- firewall reset (UFW) ----
UFW_STATUS="skipped"
if [[ "$DO_UFW" == "true" ]] && command -v ufw >/dev/null 2>&1; then
  log "Resetting UFW and allowing SSH only"
  # Reset first, then allow SSH before enabling
  ufw --force reset || true
  ufw default deny incoming || true
  ufw default allow outgoing || true
  ufw allow OpenSSH || ufw allow 22 || true
  ufw --force enable || true
  UFW_STATUS="reset"
else
  if [[ "$DO_UFW" == "true" ]]; then
    log "UFW not installed; skipping firewall step."
  else
    log "UFW step disabled by --no-ufw."
  fi
fi

# ---- final apt clean ----
apt-get autoremove -y || true
apt-get autoclean -y || true

# ---- report ----
cat > "$REPORT_PATH" <<JSON
{
  "status": "ssh_only",
  "timestamp_utc": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "purged": [
    "nginx","apache2","mysql/mariadb","php","certbot","redis","memcached","varnish"
  ],
  "removed_paths": [
    "/etc/nginx","/var/log/nginx","/etc/apache2","/var/log/apache2",
    "/etc/mysql","/var/lib/mysql","/var/log/mysql",
    "/etc/php","/var/lib/php","/var/log/php*",
    "/etc/letsencrypt","/var/log/letsencrypt",
    "/var/www",
    "/etc/redis","/var/lib/redis","/var/log/redis",
    "/etc/memcached.conf","/var/log/memcached",
    "/etc/varnish","/var/lib/varnish","/var/log/varnish"
  ],
  "ufw": "$UFW_STATUS",
  "ssh_active": "$(systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null || echo unknown)"
}
JSON

log "Done. Report: $REPORT_PATH"

# ---- optional reboot ----
if [[ "$DO_REBOOT" == "true" ]]; then
  if confirm "Reboot now to complete cleanup?"; then
    log "Rebooting..."
    reboot
  else
    log "Skipping reboot (you chose no)."
  fi
else
  log "Reboot suppressed by --no-reboot."
fi