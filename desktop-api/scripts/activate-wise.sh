#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

repo_root="/home/jerry/codebase/passwisely"
nginx_target="/etc/nginx/sites-available/passwisely.com"
nginx_candidate="/home/jerry/passwisely.com.nginx.grpc"
service_source="${repo_root}/desktop-api/systemd/passwisely-desktop-api.service"
service_target="/etc/systemd/system/passwisely-desktop-api.service"
node_bin="/home/jerry/.nvm/versions/node/v22.15.0/bin/node"

for required_file in "${nginx_target}" "${nginx_candidate}" "${service_source}" "${repo_root}/desktop-api/healthcheck.mjs"; do
  if [[ ! -f "${required_file}" ]]; then
    echo "Missing required file: ${required_file}"
    exit 1
  fi
done

install -o root -g root -m 0644 "${service_source}" "${service_target}"
systemctl daemon-reload

# Stop the temporary user-owned process used for pre-deployment validation so
# systemd can take ownership of the same loopback port.
standalone_pid="$(pgrep -u jerry -f '^/home/jerry/.nvm/versions/node/v22.15.0/bin/node desktop-api/server.mjs$' | head -n1 || true)"
if [[ -n "${standalone_pid}" ]]; then
  kill "${standalone_pid}"
  for _attempt in {1..20}; do
    kill -0 "${standalone_pid}" 2>/dev/null || break
    sleep 0.25
  done
fi

systemctl enable passwisely-desktop-api.service
systemctl restart passwisely-desktop-api.service
sudo -u jerry "${node_bin}" "${repo_root}/desktop-api/healthcheck.mjs"

backup_path="${nginx_target}.backup.grpc.$(date +%Y%m%d%H%M%S)"
cp -a "${nginx_target}" "${backup_path}"
install -o root -g root -m 0644 "${nginx_candidate}" "${nginx_target}"
if ! nginx -t; then
  cp -a "${backup_path}" "${nginx_target}"
  nginx -t
  echo "Nginx validation failed; restored ${backup_path}"
  exit 1
fi
systemctl reload nginx

sudo -u jerry env \
  PASSWISELY_GRPC_HEALTH_URL=passwisely.com:443 \
  PASSWISELY_GRPC_HEALTH_TLS=1 \
  "${node_bin}" "${repo_root}/desktop-api/healthcheck.mjs"

echo "PassWisely desktop gRPC transport is active."
