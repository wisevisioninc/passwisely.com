#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

repo_root="/home/jerry/codebase/passwisely"
website_root="${repo_root}/website"
nginx_source="${website_root}/nginx/passwisely.conf"
nginx_target="/etc/nginx/sites-available/passwisely.com"
nginx_enabled="/etc/nginx/sites-enabled/passwisely.com"
service_source="${website_root}/systemd/passwisely-web.service"
service_target="/etc/systemd/system/passwisely-web.service"
pm2_bin="/usr/local/bin/pm2"

for required_file in "${nginx_source}" "${service_source}" "${website_root}/dist/server/wrangler.json"; do
  if [[ ! -f "${required_file}" ]]; then
    echo "Missing required file: ${required_file}"
    exit 1
  fi
done

if [[ -e "${nginx_target}" ]] && ! cmp -s "${nginx_source}" "${nginx_target}"; then
  backup_path="${nginx_target}.backup.$(date +%Y%m%d%H%M%S)"
  cp -a "${nginx_target}" "${backup_path}"
  echo "Backed up the previous PassWisely Nginx config to ${backup_path}"
fi

install -o root -g root -m 0644 "${service_source}" "${service_target}"
systemctl daemon-reload

pm2_was_running=0
if [[ -x "${pm2_bin}" ]] && sudo -u jerry env PM2_HOME=/home/jerry/.pm2 "${pm2_bin}" describe passwisely-web >/dev/null 2>&1; then
  pm2_was_running=1
  sudo -u jerry env PM2_HOME=/home/jerry/.pm2 "${pm2_bin}" stop passwisely-web
fi

restore_pm2() {
  if [[ "${pm2_was_running}" -eq 1 ]]; then
    sudo -u jerry env PM2_HOME=/home/jerry/.pm2 "${pm2_bin}" restart passwisely-web || true
  fi
}
trap restore_pm2 ERR

systemctl enable --now passwisely-web.service

for attempt in {1..20}; do
  if curl --fail --silent --show-error --output /dev/null http://127.0.0.1:3011/; then
    break
  fi
  if [[ "${attempt}" -eq 20 ]]; then
    systemctl status passwisely-web.service --no-pager
    exit 1
  fi
  sleep 1
done

install -o root -g root -m 0644 "${nginx_source}" "${nginx_target}"
ln -sfn "${nginx_target}" "${nginx_enabled}"
nginx -t
systemctl reload nginx

certbot --nginx \
  --domains passwisely.com \
  --domains www.passwisely.com \
  --redirect \
  --non-interactive \
  --agree-tos \
  --email chenyejin1991@gmail.com

nginx -t
systemctl reload nginx
curl --fail --silent --show-error --location --output /dev/null https://passwisely.com/

if [[ "${pm2_was_running}" -eq 1 ]]; then
  sudo -u jerry env PM2_HOME=/home/jerry/.pm2 "${pm2_bin}" delete passwisely-web || true
fi

trap - ERR
echo "PassWisely is online at https://passwisely.com"
