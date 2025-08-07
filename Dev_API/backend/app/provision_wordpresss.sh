#!/bin/bash

DB_NAME=$1
DB_USER=$2
DB_PASS=$3
WP_EMAIL=$4
DOMAIN=${5:-wordpress}

# Update packages
apt update && apt upgrade -y

# Install required packages
apt install -y nginx mysql-server php php-fpm php-mysql unzip curl wget

# Setup MySQL DB
mysql -e "CREATE DATABASE ${DB_NAME};"
mysql -e "CREATE USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# Download WordPress
cd /var/www/
curl -O https://wordpress.org/latest.zip
unzip latest.zip
mv wordpress "${DOMAIN}"
cd "${DOMAIN}"
cp wp-config-sample.php wp-config.php

# Configure wp-config.php
sed -i \"s/database_name_here/${DB_NAME}/\" wp-config.php
sed -i \"s/username_here/${DB_USER}/\" wp-config.php
sed -i \"s/password_here/${DB_PASS}/\" wp-config.php

# Set permissions
chown -R www-data:www-data /var/www/${DOMAIN}
chmod -R 755 /var/www/${DOMAIN}

# Configure Nginx
cat > /etc/nginx/sites-available/${DOMAIN} <<EOL
server {
    listen 80;
    server_name ${DOMAIN};

    root /var/www/${DOMAIN};
    index index.php index.html;

    location / {
        try_files \$uri \$uri/ /index.php?\$args;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php-fpm.sock;
    }

    location ~ /\\.ht {
        deny all;
    }
}
EOL

ln -s /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/

# Restart services
systemctl restart nginx
systemctl restart php*-fpm

# SSL (optional)
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m ${WP_EMAIL}
