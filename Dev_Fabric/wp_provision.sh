#!/usr/bin/env bash
# WordPress LEMP Provisioner — resilient v6.2 (MySQL only)
# - Auto-detect/skip existing Nginx/MySQL/PHP-FPM
# - Repairs dpkg before installs; uses apt-get everywhere (noninteractive-safe)
# - Purges MariaDB remnants to avoid conflicts
# - MySQL self-heal: ensures /var/run/mysqld, minimal config, initializes datadir if needed
# - PHP install: generic meta first, then 8.4→8.3→8.2→8.1 fallback
# - Dynamic PHP-FPM socket detection + stable symlinks
# - WP-CLI with install retries, JSON report, never hard-fails orchestrator

# -------------------- Inputs (positional) --------------------
DOMAIN="${1:-}"                     # optional ("")
WP_PATH="${2:-/var/www/html/test}"
SITE_TITLE="${3:?site_title}"
ADMIN_USER="${4:?admin_user}"
ADMIN_PASS="${5:?admin_pass}"
ADMIN_EMAIL="${6:?admin_email}"
DB_NAME="${7:?db_name}"
DB_USER="${8:?db_user}"
DB_PASS="${9:?db_pass}"
PHP_VERSION_REQ="${10:-8.1}"        # "8.1" or "latest"
WP_VERSION="${11:-latest}"
REPORT_PATH="${12:-/tmp/wp_provision_report.json}"
LETSENCRYPT_EMAIL="${13:-}"         # used only if DOMAIN set
NONINTERACTIVE="${14:-true}"        # "true" or "false"

# -------------------- Basics --------------------
log()  { echo -e "\033[1;32m==>\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*" >&2; }
err()  { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }   # informational; script still exits 0

[ "$EUID" -eq 0 ] || { err "Run as root (sudo)."; exit 0; }

. /etc/os-release
UBU_VER="${VERSION_ID}"
CODENAME="${VERSION_CODENAME:-unknown}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

STATUS="success"
WARNINGS=()

S_UFW="pending"
S_NGINX="pending"
S_DB="pending"
S_PHP="pending"
S_WP="pending"
S_SSL="skipped"

PHP_EFF_VER=""
PHP_MODE="host-fpm-sock"
WP_EFF_VER=""
DB_MODE=""

# -------------------- Helpers --------------------
mark_warn(){ WARNINGS+=("$1"); }
safe(){ "$@" >/dev/null 2>&1 || true; }

service_active(){
  local svc="$1"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active --quiet "$svc" 2>/dev/null
    return $?
  fi
  service "$svc" status >/dev/null 2>&1
}

repair_dpkg(){
  # Heal half-configured packages so future apt steps don't fail
  safe dpkg --configure -a
  safe apt-get -f install -y
}

apt_update_resilient(){
  local tries=4 i=1
  while :; do
    if apt-get update -y >/tmp/.apt_update.log 2>&1; then return 0; fi
    if [ $i -eq 2 ]; then
      local orig="/etc/apt/sources.list"
      if [ -s "$orig" ]; then
        sed -i -E 's|http(s)?://[^ ]+/ubuntu|http://mirrors.kernel.org/ubuntu|g' "$orig"
        apt-get clean >/dev/null 2>&1 || true
      fi
    fi
    if [ $i -ge $tries ]; then
      mark_warn "apt-get update failed after $tries attempts (continuing best-effort)"
      return 0
    fi
    warn "apt-get update failed (attempt $i/$tries). Retrying in 6s…"
    sleep 6
    i=$((i+1))
  done
}

install_php_any(){
  # Try generic meta first
  if apt-get install -y php-fpm php-cli php-mysql php-xml php-curl php-zip php-gd php-mbstring php-intl >/tmp/.php_install.log 2>&1; then
    PHP_EFF_VER="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null || echo "")"
    [ -n "$PHP_EFF_VER" ] || PHP_EFF_VER="system"
    systemctl enable --now "php${PHP_EFF_VER}-fpm" >/dev/null 2>&1 || true
    return 0
  fi
  # Try explicit versions regardless of apt-cache visibility
  for v in 8.4 8.3 8.2 8.1; do
    if apt-get install -y "php${v}-fpm" "php${v}-cli" "php${v}-mysql" "php${v}-xml" "php${v}-curl" \
                          "php${v}-zip" "php${v}-gd" "php${v}-mbstring" "php${v}-intl" >/tmp/.php_install.log 2>&1; then
      PHP_EFF_VER="$v"
      systemctl enable --now "php${v}-fpm" >/dev/null 2>&1 || true
      return 0
    fi
  done
  return 1
}

php_ini_tune(){
  local ini
  ini="$(php -i 2>/dev/null | awk -F'=> ' '/Loaded Configuration File/ {print $2}')"
  [ -f "$ini" ] || return 0
  sed -i 's/^;*\s*memory_limit.*/memory_limit = 256M/' "$ini" 2>/dev/null || true
  sed -i 's/^;*\s*upload_max_filesize.*/upload_max_filesize = 64M/' "$ini" 2>/dev/null || true
  sed -i 's/^;*\s*post_max_size.*/post_max_size = 64M/' "$ini" 2>/dev/null || true
  [ -n "$PHP_EFF_VER" ] && safe systemctl reload "php${PHP_EFF_VER}-fpm"
}

wp_bin="/usr/local/bin/wp"
wp(){
  su -s /bin/bash - www-data -c "cd '$WP_PATH' && $wp_bin $*"
}

ensure_wpcli(){
  if command -v "$wp_bin" >/dev/null 2>&1; then return 0; fi
  curl -sSLo "$wp_bin" https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar >/tmp/.wpcli.log 2>&1 || return 1
  chmod +x "$wp_bin" >/dev/null 2>&1 || return 1
  return 0
}

wp_core_install_with_retries(){
  local url="$1" title="$2" user="$3" pass="$4" email="$5"
  local tries=3 i=1
  while :; do
    if wp core is-installed >/dev/null 2>&1; then return 0; fi
    if wp core install --skip-email \
       --url="$url" --title="$title" \
       --admin_user="$user" --admin_password="$pass" --admin_email="$email" \
       >/tmp/.wp_install.log 2>&1; then
      return 0
    fi
    if [ $i -ge $tries ]; then
      wp core is-installed >/dev/null 2>&1 && return 0
      return 1
    fi
    sleep 5
    i=$((i+1))
  done
}

detect_php_version(){
  if command -v php >/dev/null 2>&1; then
    PHP_EFF_VER="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null || echo "")"
  fi
}

detect_php_sock(){
  # Prefer versioned socket, then any versioned, then generic
  local s
  if [ -n "$PHP_EFF_VER" ] && [ -S "/run/php/php${PHP_EFF_VER}-fpm.sock" ]; then
    echo "/run/php/php${PHP_EFF_VER}-fpm.sock"; return 0
  fi
  s="$(ls /run/php/php*-fpm.sock 2>/dev/null | head -n1)"
  [ -n "$s" ] && { echo "$s"; return 0; }
  [ -S "/run/php/php-fpm.sock" ] && { echo "/run/php/php-fpm.sock"; return 0; }
  echo ""
}

# -------------------- Start --------------------
[ "${NONINTERACTIVE,,}" = "true" ] && export DEBIAN_FRONTEND=noninteractive

log "Ubuntu $UBU_VER ($CODENAME) — starting safe provision (MySQL, v6.2)"

# Preflight repair + apt update
repair_dpkg
apt_update_resilient

# -------------------- UFW --------------------
safe apt-get install -y ufw >/dev/null 2>&1 || true
safe ufw allow OpenSSH
safe ufw --force enable
S_UFW="enabled"

# -------------------- Nginx: detect or install --------------------
if command -v nginx >/dev/null 2>&1 || service_active nginx; then
  log "Nginx already present — skipping install."
  S_NGINX="ok"
else
  log "Installing Nginx…"
  repair_dpkg
  apt_update_resilient
  if apt-get install -y nginx >/tmp/.nginx.log 2>&1; then
    safe systemctl enable --now nginx
    S_NGINX="ok"
  else
    mark_warn "Nginx install problem (see /tmp/.nginx.log)"
    S_NGINX="skipped"
  fi
fi
[ "$S_NGINX" = "ok" ] && safe ufw allow 'Nginx Full'

# -------------------- MySQL (no MariaDB) --------------------
# Always purge MariaDB remnants first to avoid conflicts
safe apt-get purge -y mariadb-server mariadb-client mariadb-common libmariadb* libdbd-mariadb-perl

if command -v mysql >/dev/null 2>&1 || service_active mysql; then
  log "MySQL already present — ensuring it's enabled and running."
  safe systemctl enable --now mysql
else
  log "Installing MySQL Server (self-heal enabled)…"

  # Self-heal preconditions BEFORE install
  repair_dpkg
  apt_update_resilient

  # Ensure runtime dir exists and is owned properly
  safe install -o mysql -g mysql -m 755 -d /var/run/mysqld
  # Ensure data dir exists (ownership set below as needed)
  safe install -o mysql -g mysql -m 700 -d /var/lib/mysql

  # Minimal config that won't conflict with defaults (placed last)
  if [ ! -f /etc/mysql/mysql.conf.d/zz-minimal.cnf ]; then
    cat >/etc/mysql/mysql.conf.d/zz-minimal.cnf <<'CNF'
[mysqld]
datadir=/var/lib/mysql
socket=/var/run/mysqld/mysqld.sock
pid-file=/var/run/mysqld/mysqld.pid
bind-address=127.0.0.1
CNF
  fi

  # Install MySQL
  if apt-get install -y --no-install-recommends mysql-server mysql-client >/tmp/.mysql_install.log 2>&1; then
    :
  else
    mark_warn "MySQL install problem (see /tmp/.mysql_install.log)"
  fi
fi

# If system tables missing (fresh or nuked box), initialize insecure data dir
if [ ! -d /var/lib/mysql/mysql ]; then
  warn "MySQL system tables not found; initializing data directory…"
  safe mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql >/tmp/.mysql_init.log 2>&1
  safe chown -R mysql:mysql /var/lib/mysql
fi

# Start MySQL and wait
safe systemctl daemon-reload
safe systemctl enable --now mysql
for i in {1..30}; do
  mysqladmin ping --silent >/dev/null 2>&1 && break
  sleep 1
done

if command -v mysql >/dev/null 2>&1 && mysqladmin ping --silent >/dev/null 2>&1; then
  mysql -u root <<SQL >/dev/null 2>&1 || true
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
  S_DB="ok"; DB_MODE="mysql"
else
  mark_warn "MySQL unavailable after install/start (see /tmp/.mysql_install.log and journalctl -u mysql)"
fi

# -------------------- PHP: detect or install --------------------
detect_php_version
if [ -n "$PHP_EFF_VER" ] && (service_active "php${PHP_EFF_VER}-fpm" || ls /run/php/php*-fpm.sock >/dev/null 2>&1); then
  log "PHP-FPM already present (PHP ${PHP_EFF_VER}) — skipping install."
  S_PHP="ok"
else
  log "Installing PHP (requested: ${PHP_VERSION_REQ})…"
  repair_dpkg
  apt_update_resilient
  if install_php_any; then
    php_ini_tune
    S_PHP="ok"
  else
    S_PHP="skipped"
    mark_warn "Host PHP could not be installed (see /tmp/.php_install.log)"
  fi
fi
detect_php_version

# Ensure PHP-FPM socket is ready and create stable symlinks
if [ -n "$PHP_EFF_VER" ]; then
  safe systemctl enable --now "php${PHP_EFF_VER}-fpm"
  for i in {1..20}; do
    [ -S "/run/php/php${PHP_EFF_VER}-fpm.sock" ] && break
    sleep 1
  done
  if [ -S "/run/php/php${PHP_EFF_VER}-fpm.sock" ]; then
    ln -sf "/run/php/php${PHP_EFF_VER}-fpm.sock" /etc/alternatives/php-fpm.sock
    ln -sf /etc/alternatives/php-fpm.sock /run/php/php-fpm.sock
  else
    mark_warn "PHP-FPM socket not found for version ${PHP_EFF_VER}"
  fi
fi

# -------------------- Web root --------------------
log "Preparing web root at $WP_PATH…"
mkdir -p "$WP_PATH"
safe chown -R www-data:www-data "$WP_PATH"
safe chmod -R 755 "$WP_PATH"

# -------------------- WP-CLI --------------------
log "Ensuring WP-CLI…"
if ! ensure_wpcli; then
  mark_warn "WP-CLI could not be installed (see /tmp/.wpcli.log)"
fi

# -------------------- Nginx vhost --------------------
if [ "$S_NGINX" = "ok" ] && [ "$S_PHP" = "ok" ]; then
  SITENAME="${DOMAIN:-default}"
  NGX_AV="/etc/nginx/sites-available/${SITENAME}"
  NGX_EN="/etc/nginx/sites-enabled/${SITENAME}"
  PHP_SOCK="$(detect_php_sock)"

  if [ -z "$PHP_SOCK" ]; then
    mark_warn "PHP-FPM socket not found; Nginx fastcgi_pass may need manual fix"
  fi

  log "Creating Nginx server block (${SITENAME})…"
  cat > "$NGX_AV" <<NGX
server {
    listen 80 $( [ -z "$DOMAIN" ] && echo "default_server" );
    listen [::]:80 $( [ -z "$DOMAIN" ] && echo "default_server" );
    server_name $( [ -n "$DOMAIN" ] && echo "$DOMAIN www.$DOMAIN" || echo "_" );
    root $WP_PATH;
    index index.php index.html;

    access_log /var/log/nginx/${SITENAME}_access.log;
    error_log  /var/log/nginx/${SITENAME}_error.log;

    location / {
        try_files \$uri \$uri/ /index.php?\$args;
    }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass $( [ -n "$PHP_SOCK" ] && echo "unix:$PHP_SOCK" || echo "unix:/run/php/php-fpm.sock" );
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|webp)\$ {
        expires max;
        log_not_found off;
    }

    client_max_body_size 64M;
}
NGX
  ln -sf "$NGX_AV" "$NGX_EN"
  [ -f /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default || true
  safe nginx -t
  safe systemctl reload nginx
fi

# -------------------- WordPress --------------------
log "Provisioning WordPress…"

# SITE_URL
if [ -n "$DOMAIN" ]; then
  SITE_URL="http://$DOMAIN"
else
  SITE_URL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  SITE_URL="http://${SITE_URL_IP:-127.0.0.1}"
fi

INSTALL_WARN=""

if command -v "$wp_bin" >/dev/null 2>&1; then
  # Download core
  if [ ! -f "$WP_PATH/wp-load.php" ]; then
    if [ "$WP_VERSION" = "latest" ]; then
      wp core download >/tmp/.wp_core_download.log 2>&1 || mark_warn "WP core download failed"
    else
      wp core download --version="$WP_VERSION" >/tmp/.wp_core_download.log 2>&1 || mark_warn "WP core download ($WP_VERSION) failed"
    fi
  fi

  # Config DB (only if MySQL ready)
  if [ "$S_DB" = "ok" ]; then
    DB_MODE="mysql"
    if [ ! -f "$WP_PATH/wp-config.php" ]; then
      wp config create --dbname="$DB_NAME" --dbuser="$DB_USER" --dbpass="$DB_PASS" --dbhost="localhost" --skip-check >/tmp/.wp_config.log 2>&1 || mark_warn "wp-config create failed"
    fi
  else
    INSTALL_WARN="Database not ready; WordPress install will be retried on next run."
  fi

  # Install WP (only if PHP + DB OK)
  if [ "$S_PHP" = "ok" ] && [ "$S_DB" = "ok" ]; then
    if ! wp core is-installed >/dev/null 2>&1; then
      if ! wp_core_install_with_retries "$SITE_URL" "$SITE_TITLE" "$ADMIN_USER" "$ADMIN_PASS" "$ADMIN_EMAIL"; then
        INSTALL_WARN="WordPress core install step had issues after retries"
      fi
    fi
  fi

  # Version check + final status
  WP_EFF_VER="$(wp core version 2>/dev/null | tail -n1)"
  if [ -n "$WP_EFF_VER" ] || wp core is-installed >/dev/null 2>&1; then
    S_WP="ok"; INSTALL_WARN=""
  else
    [ -z "$INSTALL_WARN" ] && INSTALL_WARN="Prereqs for WordPress missing (php/db/wp-cli)"
    S_WP="skipped"
  fi

  # Perms
  safe chown -R www-data:www-data "$WP_PATH"
  safe find "$WP_PATH" -type d -exec chmod 755 {} \;
  safe find "$WP_PATH" -type f -exec chmod 644 {} \;
else
  S_WP="skipped"
  mark_warn "WP-CLI missing and could not be installed"
fi

[ -n "$INSTALL_WARN" ] && mark_warn "$INSTALL_WARN"

# -------------------- Let's Encrypt (optional) --------------------
if [ -n "$DOMAIN" ] && [ -n "$LETSENCRYPT_EMAIL" ] && [ "$S_NGINX" = "ok" ]; then
  log "Attempting Let's Encrypt for $DOMAIN…"
  repair_dpkg
  apt_update_resilient
  if apt-get install -y certbot python3-certbot-nginx >/tmp/.certbot_install.log 2>&1; then
    if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
        --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect >/tmp/.certbot_issue.log 2>&1; then
      S_SSL="issued"
      "$wp_bin" option update home "https://$DOMAIN" >/dev/null 2>&1 || true
      "$wp_bin" option update siteurl "https://$DOMAIN" >/dev/null 2>&1 || true
    else
      S_SSL="failed"; mark_warn "Certbot issuance failed (see /tmp/.certbot_issue.log)"
    fi
  else
    S_SSL="skipped"; mark_warn "Certbot not installed (see /tmp/.certbot_install.log)"
  fi
fi



# -------------------- Report --------------------
mkdir -p "$(dirname "$REPORT_PATH")" 2>/dev/null || true
{
  echo '{'
  echo "  \"timestamp\": \"${TIMESTAMP}\","
  echo "  \"status\": \"${STATUS}\","
  echo "  \"ubuntu_version\": \"${UBU_VER}\","
  echo "  \"ubuntu_codename\": \"${CODENAME}\","
  echo "  \"domain\": \"${DOMAIN}\","
  echo "  \"wp_path\": \"${WP_PATH}\","
  echo "  \"php_version_requested\": \"${PHP_VERSION_REQ}\","
  echo "  \"php_version_installed\": \"${PHP_EFF_VER}\","
  echo "  \"php_mode\": \"${PHP_MODE}\","
  echo "  \"db_mode\": \"${DB_MODE}\","
  echo "  \"nginx\": \"${S_NGINX}\","
  echo "  \"mysql\": \"${S_DB}\","
  echo "  \"wordpress\": \"${S_WP}\","
  echo "  \"wordpress_version_installed\": \"${WP_EFF_VER}\","
  echo "  \"ufw\": \"${S_UFW}\","
  echo "  \"letsencrypt\": \"${S_SSL}\","
  echo "  \"db_name\": \"${DB_NAME}\","
  echo "  \"db_user\": \"${DB_USER}\","
  echo "  \"admin_user\": \"${ADMIN_USER}\","
  if [ "${#WARNINGS[@]}" -gt 0 ]; then
    printf '  "warnings": [%s]\n' "$(printf '"%s",' "${WARNINGS[@]}" | sed 's/,$//')"
  else
    echo '  "warnings": []'
  fi
  echo '}'
} > "$REPORT_PATH"

# Perms
  safe chown -R www-data:www-data "$WP_PATH"
  safe find "$WP_PATH" -type d -exec chmod 755 {} \;
  safe find "$WP_PATH" -type f -exec chmod 644 {} \;

  # Add symlink for site if not already linked
  if [ -f "/etc/nginx/sites-available/${SITENAME}" ] && [ ! -f "/etc/nginx/sites-enabled/${SITENAME}" ]; then
    log "Linking Nginx site configuration for ${SITENAME}…"
    sudo ln -s "/etc/nginx/sites-available/${SITENAME}" "/etc/nginx/sites-enabled/${SITENAME}"
  fi

log "Report written to $REPORT_PATH"

# Final restart of Nginx for safety
if command -v nginx >/dev/null 2>&1; then
  log "Restarting Nginx to apply all changes…"
  safe systemctl restart nginx
fi

log "Done (v6.2)."
exit 0
