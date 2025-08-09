#!/usr/bin/env bash
set -euo pipefail

# -------- Args --------
DOMAIN="${1:?domain}"
WP_PATH="${2:-/var/www/html}"
SITE_TITLE="${3:?site_title}"
ADMIN_USER="${4:?admin_user}"
ADMIN_PASS="${5:?admin_pass}"
ADMIN_EMAIL="${6:?admin_email}"
DB_NAME="${7:?db_name}"
DB_USER="${8:?db_user}"
DB_PASS="${9:?db_pass}"
PHP_VERSION="${10:-8.1}"
WP_VERSION="${11:-latest}"
REPORT_PATH="${12:-/tmp/wp_provision_report.json}"
LETSENCRYPT_EMAIL="${13:-}"
NONINTERACTIVE="${14:-true}"

export DEBIAN_FRONTEND=noninteractive
log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

# -------- Detect Ubuntu & install prerequisites --------
if ! command -v lsb_release >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y lsb-release ca-certificates apt-transport-https software-properties-common curl
fi

UBU_CODENAME="$(lsb_release -cs || echo 'jammy')"
log "Ubuntu codename: $UBU_CODENAME"

need_php_ppa() {
  apt-cache policy "php${PHP_VERSION}-fpm" | grep -q 'Candidate: (none)' && return 0 || return 1
}
if need_php_ppa; then
  log "PHP ${PHP_VERSION} not in default repos; adding ondrej/php PPA"
  add-apt-repository -y ppa:ondrej/php
fi

# Install stack
log "Installing base packages"
apt-get update -y
apt-get install -y nginx mysql-server \
  "php${PHP_VERSION}-fpm" "php${PHP_VERSION}-mysql" "php${PHP_VERSION}-cli" \
  "php${PHP_VERSION}-curl" "php${PHP_VERSION}-gd" "php${PHP_VERSION}-xml" \
  "php${PHP_VERSION}-mbstring" "php${PHP_VERSION}-zip" "php${PHP_VERSION}-intl" \
  "php${PHP_VERSION}-bcmath" "php${PHP_VERSION}-exif" unzip tar curl

systemctl enable nginx mysql
systemctl start nginx mysql

# UFW (optional)
if command -v ufw >/dev/null 2>&1; then
  ufw allow 'Nginx Full' || true
  ufw allow OpenSSH || true
  if ! ufw status | grep -q "Status: active"; then ufw --force enable || true; fi
fi

# -------- wp-cli --------
if ! command -v wp >/dev/null 2>&1; then
  log "Installing wp-cli"
  curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp
  chmod +x /usr/local/bin/wp
fi

# -------- Web root --------
log "Preparing web root: ${WP_PATH}"
mkdir -p "$WP_PATH"
chown -R www-data:www-data "$WP_PATH"

if sudo -u www-data -H bash -lc "wp --path=\"$WP_PATH\" core is-installed --skip-plugins --skip-themes" >/dev/null 2>&1; then
  log "WordPress already installed; writing report and exiting"
  cat > "$REPORT_PATH" <<JSON
{"status":"already_installed","domain":"$DOMAIN","wp_path":"$WP_PATH"}
JSON
  echo "$REPORT_PATH"
  exit 0
fi

# -------- MySQL (socket root) --------
log "Configuring MySQL"
mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4;"
mysql -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';"
mysql -e "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost'; FLUSH PRIVILEGES;"

# -------- WordPress core --------
log "Downloading WordPress ($WP_VERSION)"
if [ "$WP_VERSION" = "latest" ]; then
  sudo -u www-data wp --path="$WP_PATH" core download --force
else
  sudo -u www-data wp --path="$WP_PATH" core download --version="$WP_VERSION" --force
fi

log "Creating wp-config.php"
sudo -u www-data wp --path="$WP_PATH" config create \
  --dbname="$DB_NAME" \
  --dbuser="$DB_USER" \
  --dbpass="$DB_PASS" \
  --dbhost=localhost \
  --skip-check

# --- Add FS_METHOD=direct ---
sudo -u www-data wp --path="$WP_PATH" config set FS_METHOD direct --type=constant

log "Installing WordPress"
sudo -u www-data wp --path="$WP_PATH" core install \
  --url="http://$DOMAIN" \
  --title="$SITE_TITLE" \
  --admin_user="$ADMIN_USER" \
  --admin_password="$ADMIN_PASS" \
  --admin_email="$ADMIN_EMAIL"

# -------- PHP-FPM tuning --------
cat >/etc/php/${PHP_VERSION}/fpm/conf.d/90-wordpress.ini <<INI
memory_limit = 256M
upload_max_filesize = 64M
post_max_size = 64M
max_execution_time = 120
INI
systemctl reload php${PHP_VERSION}-fpm

# -------- Nginx vhost --------
log "Configuring Nginx"
cat >/etc/nginx/sites-available/$DOMAIN <<CONF
server {
    listen 80;
    server_name $DOMAIN;
    root $WP_PATH;

    server_tokens off;
    client_max_body_size 64m;

    index index.php index.html;
    location / { try_files \$uri \$uri/ /index.php?\$args; }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php${PHP_VERSION}-fpm.sock;
    }

    location ~ /\.well-known/acme-challenge/ { allow all; }
    location ~ /\.(?!well-known) { deny all; }

    location ~* \.(png|jpg|jpeg|gif|ico|css|js|svg|webp|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
        log_not_found off;
    }
}
CONF

ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# -------- Let's Encrypt --------
CERT_STATUS="skipped"
if [ -n "$LETSENCRYPT_EMAIL" ]; then
  log "Issuing Let's Encrypt cert"
  if ! command -v snap >/dev/null 2>&1; then apt-get install -y snapd; fi
  snap install core; snap refresh core
  if ! snap list | grep -q certbot; then
    snap install --classic certbot
    ln -sf /snap/bin/certbot /usr/bin/certbot
  fi
  FLAGS="-m $LETSENCRYPT_EMAIL --agree-tos"
  [ "$NONINTERACTIVE" = "true" ] && FLAGS="--non-interactive $FLAGS"
  if certbot --nginx -d "$DOMAIN" $FLAGS; then
    systemctl reload nginx || true
    CERT_STATUS="issued"
  else
    CERT_STATUS="failed"
  fi
fi

# -------- Permissions --------
log "Normalizing permissions"
chown -R www-data:www-data "$WP_PATH"
find "$WP_PATH" -type d -exec chmod 755 {} +
find "$WP_PATH" -type f -exec chmod 644 {} +

# -------- Report --------
cat > "$REPORT_PATH" <<JSON
{
  "status": "provisioned",
  "domain": "$DOMAIN",
  "wp_path": "$WP_PATH",
  "db_name": "$DB_NAME",
  "db_user": "$DB_USER",
  "admin_user": "$ADMIN_USER",
  "php_version": "$PHP_VERSION",
  "wp_version": "$WP_VERSION",
  "lets_encrypt": "$CERT_STATUS"
}
JSON

echo "$REPORT_PATH"