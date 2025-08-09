#!/usr/bin/env bash
set -Eeuo pipefail

DRY_RUN="${DRY_RUN:-true}"

log() { echo "[$(date -Is)] $1"; }

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    eval "$@"
  fi
}

TS="$(date +%Y%m%d_%H%M%S)"
RESCUE_DIR="/root/rescue/${TS}"
run "mkdir -p $RESCUE_DIR"

log "Collecting system facts"
OS_ID="$(. /etc/os-release; echo $ID || true)"
OS_VER="$(. /etc/os-release; echo $VERSION_ID || true)"
log "OS: $OS_ID $OS_VER"

log "Stopping services if present"
for SVC in nginx php*-fpm mariadb mysql apache2 docker; do
  if systemctl list-unit-files | grep -q "^$SVC"; then
    run "systemctl stop $SVC || true"
    run "systemctl disable $SVC || true"
  fi
done

log "DB dump if MySQL/MariaDB present"
if command -v mysqldump >/dev/null 2>&1; then
  run "mysqldump --all-databases --single-transaction --quick --lock-tables=false > $RESCUE_DIR/all_dbs.sql || true"
fi

log "Tar important web & config directories"
for P in /var/www /etc/nginx /etc/php /etc/letsencrypt; do
  if [[ -d "$P" ]]; then
    run "tar -czf $RESCUE_DIR$(echo $P | sed 's#/#_#g').tgz $P || true"
  fi
done

log "Remove Nginx vhosts and sites"
run "rm -rf /etc/nginx/sites-available/* /etc/nginx/sites-enabled/* || true"

log "Remove web roots"
run "rm -rf /var/www/* || true"

log "Clean Certbot and timers"
if systemctl list-unit-files | grep -q certbot; then
  run "systemctl stop certbot.timer certbot.service || true"
  run "systemctl disable certbot.timer certbot.service || true"
fi
run "rm -rf /etc/letsencrypt/* || true"
run "crontab -l | grep -v certbot | crontab - || true"

log "Purge packages"
if command -v apt-get >/dev/null 2>&1; then
  run "apt-get update -y || true"
  run "DEBIAN_FRONTEND=noninteractive apt-get purge -y nginx* php* mariadb-server mysql-server certbot || true"
  run "DEBIAN_FRONTEND=noninteractive apt-get autoremove -y || true"
  run "apt-get clean || true"
fi

log "Remove leftovers"
run "rm -rf /etc/php /var/lib/mysql /var/log/nginx /var/log/mysql || true"

log "Docker cleanup"
if command -v docker >/dev/null 2>&1; then
  run "docker ps -aq | xargs -r docker stop || true"
  run "docker ps -aq | xargs -r docker rm || true"
  run "docker system prune -af || true"
fi

log "Reset UFW"
if command -v ufw >/dev/null 2>&1; then
  run "ufw --force reset || true"
  run "ufw allow 22/tcp || true"
  run "ufw --force enable || true"
fi

log "Flush logs"
run "find /var/log -type f -name '*.log' -delete || true"

log "Reload daemons"
run "systemctl daemon-reload || true"

log "Reset completed. Rescue artifacts in $RESCUE_DIR"