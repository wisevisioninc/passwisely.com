#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$EUID" -ne 0 ]]; then
  echo "Run with sudo."
  exit 1
fi
target=/etc/nginx/sites-available/passwisely.com
backup="${target}.before-1.2.5.$(date +%Y%m%d%H%M%S)"
for filename in PassWisely-macOS-arm64.dmg PassWisely-macOS-x64.dmg PassWisely-Windows-x64.exe; do
  curl -fsSI "https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.5/${filename}" >/dev/null
done
cp -a "$target" "$backup"
# Preserve certificates, other locations, and all other sites on this host.
sed -i 's@passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.4/@passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.5/@g' "$target"
if ! nginx -t; then
  cp -a "$backup" "$target"
  exit 1
fi
if ! nginx -s reload; then
  cp -a "$backup" "$target"
  exit 1
fi
echo "PassWisely legacy download links updated to 1.2.5."
