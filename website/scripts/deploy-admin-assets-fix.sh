#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

nginx_config="/etc/nginx/sites-available/passwisely.com"
backup_config="${nginx_config}.backup-admin-assets"

if grep -qF "location /assets/ {" "${nginx_config}"; then
  echo "Admin asset proxy is already installed."
  exit 0
fi

cp -a "${nginx_config}" "${backup_config}"
restore_config() {
  cp -a "${backup_config}" "${nginx_config}"
}
trap restore_config ERR

sed -i '/    location = \/ {/i\    # Proxy Vinext browser bundles so the admin page can hydrate.\n    location /assets/ {\n        proxy_pass http://127.0.0.1:3011;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n\n    location = /passwisely-logo-192.png {\n        proxy_pass http://127.0.0.1:3011;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n' "${nginx_config}"

nginx -t
systemctl reload nginx
trap - ERR
echo "Admin asset proxy deployed successfully."
