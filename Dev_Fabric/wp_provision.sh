#!/usr/bin/env bash
# WordPress LEMP Provisioner — resilient v6.2 (MySQL only)
# - Auto-detect/skip existing Nginx/MySQL/PHP-FPM
# - Repairs dpkg before installs; uses apt-get everywhere (noninteractive-safe)
# - Purges MariaDB remnants to avoid conflicts
# - MySQL self-heal; initializes datadir if needed
# - PHP install: generic meta first, then 8.4→8.3→8.2→8.1 fallback
# - Dynamic PHP-FPM socket detection + stable symlinks
# - Headless WP install with retries, forced en_US, JSON report

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
LOCALE="${15:-en_US}"               # WordPress language locale

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
  if apt-get install -y php-fpm php-cli php-mysql php-xml php-curl php-zip php-gd php-mbstring php-intl >/tmp/.php_install.log 2>&1; then
    PHP_EFF_VER="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null || echo "")"
    [ -n "$PHP_EFF_VER" ] || PHP_EFF_VER="system"
    systemctl enable --now "php${PHP_EFF_VER}-fpm" >/dev/null 2>&1 || true
    return 0
  fi
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

# Optional legacy helper (not used below anymore but harmless to keep)
wp(){ su -s /bin/bash - www-data -c "cd '$WP_PATH' && $wp_bin $*"; }

# New: always pass explicit --path and run as www-data
wp_run(){ 
  # Build command with proper quoting for arguments with spaces
  local cmd="$wp_bin --allow-root --path='$WP_PATH'"
  for arg in "$@"; do
    cmd="$cmd $(printf '%q' "$arg")"
  done
  su -s /bin/bash - www-data -c "$cmd"
}

ensure_wpcli(){
  if command -v "$wp_bin" >/dev/null 2>&1; then return 0; fi
  curl -sSLo "$wp_bin" https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar >/tmp/.wpcli.log 2>&1 || return 1
  chmod +x "$wp_bin" >/dev/null 2>&1 || return 1
  return 0
}

configure_php_fpm_timeouts(){
  local PHP_VER="$1"
  log "Configuring PHP-FPM timeouts and limits for plugin updates..."
  
  local PHP_INI="/etc/php/${PHP_VER}/fpm/php.ini"
  local FPM_POOL="/etc/php/${PHP_VER}/fpm/pool.d/www.conf"
  
  # Update PHP.ini settings
  if [[ -f "$PHP_INI" ]]; then
    # Backup original
    cp "$PHP_INI" "${PHP_INI}.backup" 2>/dev/null || true
    
    # Update or add settings
    sed -i 's/^max_execution_time = .*/max_execution_time = 300/' "$PHP_INI"
    sed -i 's/^memory_limit = .*/memory_limit = 512M/' "$PHP_INI"
    sed -i 's/^max_input_time = .*/max_input_time = 300/' "$PHP_INI"
    sed -i 's/^post_max_size = .*/post_max_size = 128M/' "$PHP_INI"
    sed -i 's/^upload_max_filesize = .*/upload_max_filesize = 128M/' "$PHP_INI"
    
    # Add if not present
    grep -q "^max_execution_time" "$PHP_INI" || echo "max_execution_time = 300" >> "$PHP_INI"
    grep -q "^memory_limit" "$PHP_INI" || echo "memory_limit = 512M" >> "$PHP_INI"
    grep -q "^max_input_time" "$PHP_INI" || echo "max_input_time = 300" >> "$PHP_INI"
  fi
  
  # Update FPM pool configuration
  if [[ -f "$FPM_POOL" ]]; then
    # Backup original
    cp "$FPM_POOL" "${FPM_POOL}.backup" 2>/dev/null || true
    
    # Add or update pool settings
    grep -q "^request_terminate_timeout" "$FPM_POOL" || echo "request_terminate_timeout = 300s" >> "$FPM_POOL"
    grep -q "^pm.max_requests" "$FPM_POOL" || echo "pm.max_requests = 500" >> "$FPM_POOL"
    sed -i 's/^request_terminate_timeout = .*/request_terminate_timeout = 300s/' "$FPM_POOL"
  fi
  
  log "PHP-FPM timeout configuration completed"
}

configure_nginx_timeouts(){
  log "Configuring Nginx timeouts for plugin updates..."
  
  local NGINX_CONF="/etc/nginx/nginx.conf"
  local SITE_CONF="/etc/nginx/sites-available/default"
  
  # Update main nginx.conf
  if [[ -f "$NGINX_CONF" ]]; then
    # Backup original
    cp "$NGINX_CONF" "${NGINX_CONF}.backup" 2>/dev/null || true
    
    # Add timeout settings to http block if not present
    if ! grep -q "proxy_read_timeout" "$NGINX_CONF"; then
      sed -i '/http {/a\    proxy_read_timeout 300s;\n    proxy_connect_timeout 300s;\n    fastcgi_read_timeout 300s;\n    fastcgi_send_timeout 300s;\n    fastcgi_connect_timeout 300s;' "$NGINX_CONF"
    fi
  fi
  
  # Update site-specific config
  if [[ -f "$SITE_CONF" ]]; then
    # Backup original
    cp "$SITE_CONF" "${SITE_CONF}.backup" 2>/dev/null || true
    
    # Add PHP location block with timeouts if not present
    if ! grep -q "fastcgi_read_timeout" "$SITE_CONF"; then
      # Find PHP location block and add timeouts
      sed -i '/location ~ \.php\$ {/a\        fastcgi_read_timeout 300s;\n        fastcgi_send_timeout 300s;\n        fastcgi_connect_timeout 300s;' "$SITE_CONF"
    fi
  fi
  
  # Test nginx configuration
  if nginx -t >/dev/null 2>&1; then
    log "Nginx timeout configuration completed successfully"
  else
    warn "Nginx configuration test failed, restoring backup"
    [[ -f "${NGINX_CONF}.backup" ]] && cp "${NGINX_CONF}.backup" "$NGINX_CONF" 2>/dev/null || true
    [[ -f "${SITE_CONF}.backup" ]] && cp "${SITE_CONF}.backup" "$SITE_CONF" 2>/dev/null || true
  fi
}

configure_wp_config_constants(){
  log "Adding WordPress configuration constants to wp-config.php..."
  
  local WP_CONFIG="${WP_PATH}/wp-config.php"
  
  if [[ ! -f "$WP_CONFIG" ]]; then
    warn "wp-config.php not found at $WP_CONFIG"
    return 1
  fi
  
  # Backup original wp-config.php
  cp "$WP_CONFIG" "${WP_CONFIG}.backup" 2>/dev/null || true
  
  # Define the constants to add
  local CONSTANTS="
/* Custom WordPress Constants - Added by Provisioner */
define('REST_AUTHORIZATION_HEADER', true);
define('FS_METHOD', 'direct');
define('WP_MEMORY_LIMIT', '512M');
define('DISALLOW_FILE_MODS', false);
define('WP_MAX_MEMORY_LIMIT', '512M');
/* End Custom Constants */
"
  
  # Check if constants already exist to avoid duplicates
  if ! grep -q "REST_AUTHORIZATION_HEADER" "$WP_CONFIG"; then
    # Insert constants before the "/* That's all, stop editing!" line
    if grep -q "That's all, stop editing" "$WP_CONFIG"; then
      # Insert before the stop editing line
      sed -i "/\/\* That's all, stop editing/i\\$CONSTANTS" "$WP_CONFIG"
    else
      # If the standard line doesn't exist, append before the closing PHP tag or at the end
      if grep -q "?>" "$WP_CONFIG"; then
        sed -i "/<?>/i\\$CONSTANTS" "$WP_CONFIG"
      else
        echo "$CONSTANTS" >> "$WP_CONFIG"
      fi
    fi
    
    log "WordPress configuration constants added successfully"
  else
    log "WordPress configuration constants already exist, skipping..."
  fi
  
  # Verify the file is still valid PHP
  if php -l "$WP_CONFIG" >/dev/null 2>&1; then
    log "wp-config.php syntax validation passed"
    return 0
  else
    warn "wp-config.php syntax error detected, restoring backup"
    cp "${WP_CONFIG}.backup" "$WP_CONFIG" 2>/dev/null || true
    return 1
  fi
}

configure_wp_language(){
  log "Configuring WordPress language to ${LOCALE}..."
  
  local WP_LANG_CODE
  case "$LOCALE" in
    "en_US") WP_LANG_CODE="en_US" ;;
    "es_ES") WP_LANG_CODE="es_ES" ;;
    "fr_FR") WP_LANG_CODE="fr_FR" ;;
    "de_DE") WP_LANG_CODE="de_DE" ;;
    "it_IT") WP_LANG_CODE="it_IT" ;;
    "pt_BR") WP_LANG_CODE="pt_BR" ;;
    "ja")    WP_LANG_CODE="ja" ;;
    "zh_CN") WP_LANG_CODE="zh_CN" ;;
    *) 
      log "Using default English (en_US) locale"
      WP_LANG_CODE="en_US"
      ;;
  esac
  
  if [[ "$WP_LANG_CODE" != "en_US" ]]; then
    # Download and install language pack
    if wp_run language core install "$WP_LANG_CODE" >/dev/null 2>&1; then
      log "Language pack $WP_LANG_CODE downloaded successfully"
      
      # Activate the language
      if wp_run language core activate "$WP_LANG_CODE" >/dev/null 2>&1; then
        log "WordPress language set to $WP_LANG_CODE"
      else
        warn "Failed to activate language $WP_LANG_CODE, keeping English"
      fi
    else
      warn "Failed to download language pack $WP_LANG_CODE, keeping English"
    fi
  else
    log "WordPress language already set to English (en_US)"
  fi
  
  # Verify current language
  local CURRENT_LANG
  CURRENT_LANG=$(wp_run option get WPLANG 2>/dev/null || echo "en_US")
  log "Current WordPress language: ${CURRENT_LANG:-en_US}"
}

install_plugin_from_github(){
  local repo_url="$1"
  local plugin_name="$2"
  local branch="${3:-main}"
  
  log "Installing plugin '$plugin_name' from GitHub: $repo_url"
  
  local temp_dir="/tmp/github_plugin_$plugin_name"
  local plugins_dir="${WP_PATH}/wp-content/plugins"
  
  # Clean up any existing temp directory
  rm -rf "$temp_dir" 2>/dev/null || true
  
  # Clone the repository
  if git clone -b "$branch" --depth 1 "$repo_url" "$temp_dir" >/dev/null 2>&1; then
    log "Successfully cloned GitHub repository"
    
    # Move plugin to WordPress plugins directory
    if [[ -d "$temp_dir" ]]; then
      # Remove .git directory to clean up
      rm -rf "$temp_dir/.git" 2>/dev/null || true
      
      # Move to plugins directory
      if mv "$temp_dir" "$plugins_dir/$plugin_name" 2>/dev/null; then
        log "Plugin '$plugin_name' installed successfully from GitHub"
        
        # Set proper permissions
        chown -R www-data:www-data "$plugins_dir/$plugin_name" 2>/dev/null || true
        chmod -R 755 "$plugins_dir/$plugin_name" 2>/dev/null || true
        
        # Activate plugin
        wp_run plugin activate "$plugin_name" >/dev/null 2>&1 && log "Plugin '$plugin_name' activated" || warn "Failed to activate plugin '$plugin_name'"
        
        return 0
      else
        warn "Failed to move plugin '$plugin_name' to plugins directory"
      fi
    fi
  else
    warn "Failed to clone GitHub repository: $repo_url"
  fi
  
  # Clean up temp directory
  rm -rf "$temp_dir" 2>/dev/null || true
  return 1
}

install_plugin_from_local(){
  local local_plugin_path="$1"
  local plugin_name="$2"
  
  log "Installing local plugin '$plugin_name' from: $local_plugin_path"
  
  local plugins_dir="${WP_PATH}/wp-content/plugins"
  local target_dir="$plugins_dir/$plugin_name"
  
  # Check if local plugin path exists
  if [[ ! -d "$local_plugin_path" && ! -f "$local_plugin_path" ]]; then
    warn "Local plugin path does not exist: $local_plugin_path"
    return 1
  fi
  
  # Handle zip files
  if [[ "$local_plugin_path" == *.zip ]]; then
    log "Extracting ZIP plugin: $local_plugin_path"
    local temp_dir="/tmp/local_plugin_$plugin_name"
    rm -rf "$temp_dir" 2>/dev/null || true
    mkdir -p "$temp_dir"
    
    if unzip -q "$local_plugin_path" -d "$temp_dir" 2>/dev/null; then
      # Find the main plugin directory (usually the first directory in zip)
      local extracted_dir=$(find "$temp_dir" -mindepth 1 -maxdepth 1 -type d | head -1)
      if [[ -n "$extracted_dir" ]]; then
        if mv "$extracted_dir" "$target_dir" 2>/dev/null; then
          log "Local ZIP plugin '$plugin_name' installed successfully"
        else
          warn "Failed to move extracted plugin to plugins directory"
          rm -rf "$temp_dir" 2>/dev/null || true
          return 1
        fi
      else
        warn "No plugin directory found in ZIP file"
        rm -rf "$temp_dir" 2>/dev/null || true
        return 1
      fi
    else
      warn "Failed to extract ZIP file: $local_plugin_path"
      rm -rf "$temp_dir" 2>/dev/null || true
      return 1
    fi
    rm -rf "$temp_dir" 2>/dev/null || true
  else
    # Handle directory
    if cp -r "$local_plugin_path" "$target_dir" 2>/dev/null; then
      log "Local plugin '$plugin_name' copied successfully"
    else
      warn "Failed to copy local plugin directory"
      return 1
    fi
  fi
  
  # Set proper permissions
  chown -R www-data:www-data "$target_dir" 2>/dev/null || true
  chmod -R 755 "$target_dir" 2>/dev/null || true
  
  # Activate plugin
  wp_run plugin activate "$plugin_name" >/dev/null 2>&1 && log "Plugin '$plugin_name' activated" || warn "Failed to activate plugin '$plugin_name'"
  
  return 0
}

install_custom_plugins(){
  log "Installing custom plugins..."
  
  # Install Basic Auth plugin from GitHub (WP-API repository)
  install_plugin_from_github "https://github.com/WP-API/Basic-Auth.git" "basic-auth" "master"
  
  # Install remote-plugins-updater from your GitHub repository
  install_plugin_from_github "https://github.com/shakauthossain/remote-plugins-updater.git" "remote-plugins-updater" "main"
  
  log "Custom plugin installation completed"
}

wp_core_install_with_retries(){
  local url="$1" title="$2" user="$3" pass="$4" email="$5" locale="$6"
  local tries=3 i=1
  while :; do
    if wp_run core is-installed >/dev/null 2>&1; then 
      log "WordPress installation verified successfully"
      return 0
    fi
    
    log "Attempting WordPress installation (attempt $i/$tries)..."
    # Use array to properly handle arguments with spaces
    local wp_install_args=(
      "core" "install" "--skip-email"
      "--url=$url"
      "--title=$title"
      "--admin_user=$user"
      "--admin_password=$pass"
      "--admin_email=$email"
      "--locale=$locale"
    )
    if wp_run "${wp_install_args[@]}" >/tmp/.wp_install_${i}.log 2>&1; then
      log "WordPress core install command completed"
      # Verify installation worked
      if wp_run core is-installed >/dev/null 2>&1; then
        log "WordPress installation verification successful"
        return 0
      else
        warn "WordPress install command succeeded but verification failed (attempt $i)"
      fi
    else
      warn "WordPress install command failed (attempt $i), see /tmp/.wp_install_${i}.log"
      cat /tmp/.wp_install_${i}.log || true
    fi
    
    if [ $i -ge $tries ]; then
      warn "WordPress installation failed after $tries attempts"
      # Final verification attempt
      if wp_run core is-installed >/dev/null 2>&1; then
        log "Final verification: WordPress is actually installed"
        return 0
      fi
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

# -------------------- Nginx --------------------
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
safe apt-get purge -y mariadb-server mariadb-client mariadb-common libmariadb* libdbd-mariadb-perl
if command -v mysql >/dev/null 2>&1 || service_active mysql; then
  log "MySQL already present — ensuring it's enabled and running."
  safe systemctl enable --now mysql
else
  log "Installing MySQL Server (self-heal enabled)…"
  repair_dpkg
  apt_update_resilient
  safe install -o mysql -g mysql -m 755 -d /var/run/mysqld
  safe install -o mysql -g mysql -m 700 -d /var/lib/mysql
  if [ ! -f /etc/mysql/mysql.conf.d/zz-minimal.cnf ]; then
    cat >/etc/mysql/mysql.conf.d/zz-minimal.cnf <<'CNF'
[mysqld]
datadir=/var/lib/mysql
socket=/var/run/mysqld/mysqld.sock
pid-file=/var/run/mysqld/mysqld.pid
bind-address=127.0.0.1
CNF
  fi
  apt-get install -y --no-install-recommends mysql-server mysql-client >/tmp/.mysql_install.log 2>&1 || mark_warn "MySQL install problem (see /tmp/.mysql_install.log)"
fi

if [ ! -d /var/lib/mysql/mysql ]; then
  warn "MySQL system tables not found; initializing data directory…"
  safe mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql >/tmp/.mysql_init.log 2>&1
  safe chown -R mysql:mysql /var/lib/mysql
fi

safe systemctl daemon-reload
safe systemctl enable --now mysql
for i in {1..30}; do mysqladmin ping --silent >/dev/null 2>&1 && break; sleep 1; done

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

# -------------------- PHP --------------------
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
    # Configure PHP-FPM and Nginx timeouts for plugin updates
    if [[ -n "$PHP_EFF_VER" ]]; then
      configure_php_fpm_timeouts "$PHP_EFF_VER"
      configure_nginx_timeouts
      # Restart services to apply new configurations
      safe systemctl restart "php${PHP_EFF_VER}-fpm"
      safe systemctl restart nginx
      log "Timeout configurations applied and services restarted"
    fi
    S_PHP="ok"
  else
    S_PHP="skipped"; mark_warn "Host PHP could not be installed (see /tmp/.php_install.log)"
  fi
fi
detect_php_version

if [ -n "$PHP_EFF_VER" ]; then
  safe systemctl enable --now "php${PHP_EFF_VER}-fpm"
  for i in {1..20}; do [ -S "/run/php/php${PHP_EFF_VER}-fpm.sock" ] && break; sleep 1; done
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
  [ -z "$PHP_SOCK" ] && mark_warn "PHP-FPM socket not found; Nginx fastcgi_pass may need manual fix"

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

# SITE_URL (needed for headless install)
if [ -n "$DOMAIN" ]; then
  SITE_URL="http://$DOMAIN"
else
  SITE_URL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  SITE_URL="http://${SITE_URL_IP:-127.0.0.1}"
fi

INSTALL_WARN=""

if command -v "$wp_bin" >/dev/null 2>&1; then
  # (a) Download core if missing — pinned to $LOCALE
  if [ ! -f "$WP_PATH/wp-load.php" ]; then
    if [ "$WP_VERSION" = "latest" ]; then
      wp_run core download --locale="$LOCALE" >/tmp/.wp_core_download.log 2>&1 || mark_warn "WP core download failed"
    else
      wp_run core download --version="$WP_VERSION" --locale="$LOCALE" >/tmp/.wp_core_download.log 2>&1 || mark_warn "WP core download ($WP_VERSION) failed"
    fi
  fi

  # (b) Create wp-config.php when DB is ready
  if [ "$S_DB" = "ok" ]; then
    DB_MODE="mysql"
    if [ ! -f "$WP_PATH/wp-config.php" ]; then
      log "Creating wp-config.php..."
      if wp_run config create --dbname="$DB_NAME" --dbuser="$DB_USER" --dbpass="$DB_PASS" --dbhost="localhost" --skip-check \
        >/tmp/.wp_config.log 2>&1; then
        log "wp-config.php created successfully"
        # Set proper permissions immediately
        safe chown www-data:www-data "$WP_PATH/wp-config.php"
        safe chmod 644 "$WP_PATH/wp-config.php"
      else
        warn "wp-config create failed, check /tmp/.wp_config.log"
        cat /tmp/.wp_config.log || true
      fi
    else
      log "wp-config.php already exists"
    fi
  else
    INSTALL_WARN="Database not ready; WordPress install will be retried on next run."
  fi

  # (c) Headless install if PHP + DB OK and not installed yet
  if [ "$S_PHP" = "ok" ] && [ "$S_DB" = "ok" ]; then
    # Ensure proper file ownership before installation
    safe chown -R www-data:www-data "$WP_PATH"
    safe chmod -R 755 "$WP_PATH"
    
    # Test database connection before proceeding
    if ! wp_run db check >/dev/null 2>&1; then
      warn "Database connection failed, attempting to recreate wp-config.php..."
      rm -f "$WP_PATH/wp-config.php"
      wp_run config create --dbname="$DB_NAME" --dbuser="$DB_USER" --dbpass="$DB_PASS" --dbhost="localhost" --skip-check \
        >/tmp/.wp_config_retry.log 2>&1 || mark_warn "wp-config recreate failed"
    fi
    
    if ! wp_run core is-installed >/dev/null 2>&1; then
      log "WordPress not installed, proceeding with installation..."
      if ! wp_core_install_with_retries "$SITE_URL" "$SITE_TITLE" "$ADMIN_USER" "$ADMIN_PASS" "$ADMIN_EMAIL" "$LOCALE"; then
        INSTALL_WARN="WordPress core install step had issues after retries"
        # Try manual verification
        if wp_run core is-installed >/dev/null 2>&1; then
          log "WordPress installation completed successfully on retry verification"
        else
          warn "WordPress installation failed - will redirect to install.php"
        fi
      else
        log "WordPress installation completed successfully"
      fi
    else
      log "WordPress already installed, skipping installation step"
    fi

    # Only proceed with post-install configuration if WordPress is actually installed
    if wp_run core is-installed >/dev/null 2>&1; then
      log "Configuring WordPress post-installation settings..."
      
      # Configure WordPress language (enhanced language setup)
      configure_wp_language
      
      # Configure sane defaults
      wp_run option update blog_public 0 >/dev/null 2>&1 || true
      wp_run rewrite structure "/%postname%/" >/dev/null 2>&1 || true
      wp_run rewrite flush --hard >/dev/null 2>&1 || true
      
      S_WP="ok"
    else
      warn "WordPress installation verification failed"
      S_WP="failed"
    fi

    # Configure WordPress constants for plugin updates and performance
    if configure_wp_config_constants; then
      # Set proper ownership after modifying wp-config.php
      safe chown www-data:www-data "${WP_PATH}/wp-config.php"
      safe chmod 644 "${WP_PATH}/wp-config.php"
      log "WordPress configuration constants and file permissions updated"
    fi

    # --- Info page (idempotent) ---
    INFO_PAGE_TITLE="Info"
    INFO_PAGE_SLUG="info"
    MAKE_INFO_HOMEPAGE="${MAKE_INFO_HOMEPAGE:-false}"  # export MAKE_INFO_HOMEPAGE=true to set as homepage

    # Build content without heredocs (avoids EOF issues)
    INFO_PAGE_CONTENT="$(printf '%b' "<h2>About this site</h2>\n<p><strong>Site:</strong> ${SITE_TITLE}</p>\n<p><strong>Admin contact:</strong> ${ADMIN_EMAIL}</p>\n")"

    # Find or create the page
    PAGE_ID="$(wp_run post list --post_type=page --pagename="$INFO_PAGE_SLUG" --field=ID 2>/dev/null | tail -n1)"
    if [ -z "$PAGE_ID" ]; then
      PAGE_ID="$(wp_run post create \
        --post_type=page \
        --post_status=publish \
        --post_title="$INFO_PAGE_TITLE" \
        --post_name="$INFO_PAGE_SLUG" \
        --post_content="$INFO_PAGE_CONTENT" \
        --porcelain 2>/dev/null | tail -n1)"
    else
      wp_run post update "$PAGE_ID" \
        --post_title="$INFO_PAGE_TITLE" \
        --post_content="$INFO_PAGE_CONTENT" >/dev/null 2>&1 || true
    fi

    # Optionally make it the homepage (fixed /dev/null)
    if [ "${MAKE_INFO_HOMEPAGE,,}" = "true" ] && [ -n "$PAGE_ID" ]; then
      wp_run option update show_on_front page >/dev/null 2>&1 || true
      wp_run option update page_on_front "$PAGE_ID" >/dev/null 2>&1 || true
    fi

    # Ensure the site title & admin email reflect inputs (post-install idempotent)
    wp_run option update blogname "$SITE_TITLE" >/dev/null 2>&1 || true
    wp_run option update admin_email "$ADMIN_EMAIL" >/dev/null 2>&1 || true
  fi

  # Version check + final status
  # Final WordPress verification and status
  WP_EFF_VER="$(wp_run core version 2>/dev/null | tail -n1)"
  
  log "=== WordPress Installation Verification ==="
  
  # Check if WordPress is installed
  if wp_run core is-installed >/dev/null 2>&1; then
    S_WP="ok"; INSTALL_WARN=""
    log "✓ WordPress is properly installed"
    log "✓ WordPress version: ${WP_EFF_VER:-unknown}"
    
    # Check if we can access the database
    if wp_run db check >/dev/null 2>&1; then
      log "✓ Database connection working"
    else
      warn "✗ Database connection issues detected"
    fi
    
    # Check if admin user exists
    if wp_run user get "$ADMIN_USER" >/dev/null 2>&1; then
      log "✓ Admin user '$ADMIN_USER' exists"
    else
      warn "✗ Admin user '$ADMIN_USER' not found"
    fi
    
    # Check wp-config.php
    if [[ -f "$WP_PATH/wp-config.php" ]]; then
      log "✓ wp-config.php exists"
    else
      warn "✗ wp-config.php missing"
    fi
    
  else
    warn "✗ WordPress installation verification failed"
    warn "  This means the site will redirect to wp-admin/install.php"
    
    # Debug information
    log "=== Debug Information ==="
    log "WordPress path: $WP_PATH"
    log "wp-config.php exists: $([[ -f "$WP_PATH/wp-config.php" ]] && echo "yes" || echo "no")"
    log "Database status: $S_DB"
    log "PHP status: $S_PHP"
    
    if [[ -f "/tmp/.wp_install_1.log" ]]; then
      log "Last installation attempt log:"
      tail -10 /tmp/.wp_install_1.log 2>/dev/null || true
    fi
    
    S_WP="failed"
    INSTALL_WARN="WordPress installation incomplete - will show install.php"
  fi

  # Set proper permissions
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
      wp_run option update home "https://$DOMAIN" >/dev/null 2>&1 || true
      wp_run option update siteurl "https://$DOMAIN" >/dev/null 2>&1 || true
    else
      S_SSL="failed"; mark_warn "Certbot issuance failed (see /tmp/.certbot_issue.log)"
    fi
  else
    S_SSL="skipped"; mark_warn "Certbot not installed (see /tmp/.certbot_install.log)"
  fi
fi

# -------------------- Plugin Update Hardening (add-only) --------------------
log "Applying plugin-update hardening (timeouts, auth header, FS perms)…"

# 1) Nginx: ensure Authorization header forwarded + generous timeouts in PHP location
if [ "$S_NGINX" = "ok" ]; then
  SITENAME="${DOMAIN:-default}"
  NGX_AV="/etc/nginx/sites-available/${SITENAME}"

  if [ -f "$NGX_AV" ]; then
    # Insert only if missing
    if ! grep -q 'HTTP_AUTHORIZATION' "$NGX_AV"; then
      awk '
        { print }
        /location ~ \\.php\\$/ && !ins { ins=1; print "        fastcgi_param HTTP_AUTHORIZATION $http_authorization;"; print "        fastcgi_read_timeout 600s;"; print "        fastcgi_send_timeout 600s;"; }
      ' "$NGX_AV" > "${NGX_AV}.tmp" && mv "${NGX_AV}.tmp" "$NGX_AV"
    fi
    if ! grep -q 'fastcgi_read_timeout 600s' "$NGX_AV"; then
      sed -i '/location ~ \.php\$/,/}/ s|^\(\s*\)include snippets/fastcgi-php.conf;|\0\n\1fastcgi_read_timeout 600s;\n\1fastcgi_send_timeout 600s;|' "$NGX_AV"
    fi
    safe nginx -t && safe systemctl reload nginx
  else
    mark_warn "Nginx site file not found for timeout/auth insert ($NGX_AV)"
  fi
fi

# 2) PHP: raise execution/memory + FPM request timeout (non-destructive edits)
detect_php_version
PHP_INI="$(php -i 2>/dev/null | awk -F'=> ' '/Loaded Configuration File/ {print $2}')"
if [ -n "$PHP_INI" ] && [ -f "$PHP_INI" ]; then
  sed -i 's/^;*\s*memory_limit\s*=.*/memory_limit = 512M/' "$PHP_INI" || true
  sed -i 's/^;*\s*max_execution_time\s*=.*/max_execution_time = 600/' "$PHP_INI" || true
  sed -i 's/^;*\s*post_max_size\s*=.*/post_max_size = 128M/' "$PHP_INI" || true
  sed -i 's/^;*\s*upload_max_filesize\s*=.*/upload_max_filesize = 128M/' "$PHP_INI" || true
fi

if [ -n "$PHP_EFF_VER" ] && [ -d "/etc/php/${PHP_EFF_VER}/fpm/pool.d" ]; then
  cat >/etc/php/${PHP_EFF_VER}/fpm/pool.d/zz-plugin-updates.conf <<EOF
; Added for long-running plugin updates
request_terminate_timeout = 600s
pm.max_requests = 500
EOF
  safe systemctl reload "php${PHP_EFF_VER}-fpm"
fi

# 3) WordPress runtime: ensure direct FS writes + ample memory
if [ -f "$WP_PATH/wp-config.php" ]; then
  if ! grep -q "FS_METHOD" "$WP_PATH/wp-config.php"; then
    printf "\ndefine('FS_METHOD','direct');\n" >> "$WP_PATH/wp-config.php"
  fi
  if ! grep -q "WP_MEMORY_LIMIT" "$WP_PATH/wp-config.php"; then
    printf "define('WP_MEMORY_LIMIT','512M');\n" >> "$WP_PATH/wp-config.php"
  fi
fi

# 4) Ensure required auth plugin present (idempotent)
if command -v "$wp_bin" >/dev/null 2>&1; then
  # JSON Basic Auth for REST
  wp_run plugin install json-basic-authentication --activate >/dev/null 2>&1 || true

  # Install custom plugins
  install_custom_plugins

  # Flush rewrite just in case REST routes changed
  wp_run rewrite flush --hard >/dev/null 2>&1 || true
fi

# 5) Final: reload Nginx once more after PHP changes
if command -v nginx >/dev/null 2>&1; then
  safe nginx -t && safe systemctl reload nginx
fi
# ------------------ end Plugin Update Hardening ------------------

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

# Permissions again (just in case)
safe chown -R www-data:www-data "$WP_PATH"
safe find "$WP_PATH" -type d -exec chmod 755 {} \;
safe find "$WP_PATH" -type f -exec chmod 644 {} \;

# Link site config if missing (idempotent)
if [ -f "/etc/nginx/sites-available/${SITENAME}" ] && [ ! -f "/etc/nginx/sites-enabled/${SITENAME}" ]; then
  log "Linking Nginx site configuration for ${SITENAME}…"
  ln -s "/etc/nginx/sites-available/${SITENAME}" "/etc/nginx/sites-enabled/${SITENAME}" >/dev/null 2>&1 || true
fi

log "Report written to $REPORT_PATH"

# Final restart of Nginx for safety
if command -v nginx >/dev/null 2>&1; then
  log "Restarting Nginx to apply all changes…"
  safe systemctl restart nginx
fi

log "Done (v6.2)."
exit 0
