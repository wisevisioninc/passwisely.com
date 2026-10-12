#!/usr/bin/env bash
# Run after the signed installers and staged production build have been verified.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/release-download-health.sh"
[[ "$EUID" -eq 0 ]] || { echo "Run with sudo."; exit 1; }
revision="${1:?Pass the verified Git commit SHA}"
staged="${2:?Pass the staged website dist directory}"
repo=/home/jerry/codebase/passwisely
nginx_config=/etc/nginx/sites-available/passwisely.com
node=/home/jerry/.nvm/versions/node/v22.15.0/bin/node
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ -f "$staged/server/wrangler.json" && -f "$staged/server/.dev.vars" ]] || exit 1
[[ ! -e "$repo/website/dist-1.2.6-staged" ]] || { echo "Staging destination already exists; inspect it before retrying."; exit 1; }
sudo -u jerry git -C "$repo" diff --quiet
sudo -u jerry git -C "$repo" diff --cached --quiet
sudo -u jerry git -C "$repo" merge-base --is-ancestor HEAD "$revision"
for file in PassWisely-macOS-arm64.dmg PassWisely-macOS-x64.dmg PassWisely-Windows-x64.exe; do
  curl -fsSI --max-time 30 "https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.6/$file" >/dev/null
done
backup="/home/jerry/passwisely-backups/1.2.6-$(date +%Y%m%d%H%M%S)"
install -d -m 0700 "$backup"
cp -a "$nginx_config" "$backup/nginx.conf"
cp -a "$repo/website/dist" "$backup/dist"
sudo -u jerry git -C "$repo" rev-parse HEAD > "$backup/previous-commit"
rollback() {
  echo "Activation failed at line $1 (exit $2); restoring the previous web build and redirects." >&2
  trap - ERR
  cp -a "$backup/nginx.conf" "$nginx_config"
  # The new desktop API retains the old unary interface. Restore the previous
  # web build while retaining Git history and the backup for diagnosis.
  systemctl stop passwisely-web.service passwisely-desktop-api.service || true
  rm -rf "$repo/website/dist"
  cp -a "$backup/dist" "$repo/website/dist"
  systemctl restart passwisely-web.service passwisely-desktop-api.service || true
  nginx -t && systemctl reload nginx || true
  echo "Activation failed; previous web build/download redirects restored. Backup: $backup" >&2
  exit 1
}
trap 'rollback "$LINENO" "$?"' ERR
sudo -u jerry git -C "$repo" merge --ff-only "$revision"
cp -a "$staged" "$repo/website/dist-1.2.6-staged"
chown -R jerry:jerry "$repo/website/dist-1.2.6-staged"
systemctl stop passwisely-web.service passwisely-desktop-api.service
mv "$repo/website/dist" "$backup/dist-replaced"
mv "$repo/website/dist-1.2.6-staged" "$repo/website/dist"
sed -i 's@passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.5/@passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.6/@g' "$nginx_config"
nginx -t
systemctl restart passwisely-desktop-api.service passwisely-web.service
ready=0
for attempt in {1..20}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3011/ >/dev/null && sudo -u jerry "$node" "$repo/desktop-api/healthcheck.mjs" >/dev/null; then
    ready=1; break
  fi
  sleep 1
done
[[ "$ready" == 1 ]]
systemctl reload nginx
release_url=https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.6
wait_for_redirect https://passwisely.com/api/download/mac-arm64 "$release_url/PassWisely-macOS-arm64.dmg"
wait_for_redirect https://passwisely.com/api/download/mac-x64 "$release_url/PassWisely-macOS-x64.dmg"
wait_for_redirect https://passwisely.com/api/download/windows-x64 "$release_url/PassWisely-Windows-x64.exe"
trap - ERR
echo "PassWisely 1.2.6 activated. Backup: $backup"
