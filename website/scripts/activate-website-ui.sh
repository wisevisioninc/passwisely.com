#!/usr/bin/env bash
set -Eeuo pipefail

# Switch only the website build. Desktop services, Nginx and releases stay intact.
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo."; exit 1; }
revision="${1:?Expected Git commit required}"
staged_dist="${2:?Staged dist directory required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit."; exit 1; }
repo=/home/jerry/codebase/passwisely
website="$repo/website"
node=/home/jerry/.nvm/versions/node/v22.15.0/bin/node
service=passwisely-web.service

for path in "$staged_dist/server/wrangler.json" "$staged_dist/server/index.js" "$staged_dist/client" "$website/dist/server/.dev.vars"; do
  [[ -e "$path" ]] || { echo "Missing: $path"; exit 1; }
done
sudo -u jerry git -C "$repo" diff --quiet
sudo -u jerry git -C "$repo" diff --cached --quiet
sudo -u jerry git -C "$repo" merge-base --is-ancestor HEAD "$revision"
# Check the staged build's relative paths before stopping a running service.
"$node" -e 'const fs=require("fs"); const p=process.argv[1]; const c=JSON.parse(fs.readFileSync(p)); if(!c.main || !c.assets?.directory) process.exit(1)' "$staged_dist/server/wrangler.json"

backup="/home/jerry/passwisely-backups/website-ui-$(date +%Y%m%d%H%M%S)"
install -d -o jerry -g jerry -m 0700 "$backup"
sudo -u jerry git -C "$repo" rev-parse HEAD > "$backup/previous-commit"
next_dist=$(mktemp -d "$website/.dist-ui.XXXXXX")
cp -a "$staged_dist/." "$next_dist/"
# Reuse protected server configuration; this release changes presentation only.
install -o jerry -g jerry -m 0600 "$website/dist/server/.dev.vars" "$next_dist/server/.dev.vars"
chown -R jerry:jerry "$next_dist"

switched=0
stopped=0
rollback() {
  local status=$?
  trap - ERR
  echo "Website activation failed (exit $status); restoring the previous build."
  if [[ "$switched" -eq 1 ]]; then
    systemctl stop "$service" || true
    if [[ -d "$website/dist" ]]; then mv "$website/dist" "$backup/failed-dist"; fi
    mv "$backup/dist" "$website/dist"
  fi
  if [[ "$stopped" -eq 1 ]]; then systemctl start "$service" || true; fi
  echo "Backup: $backup. Git source may be newer; the previous website runtime was restored."
  exit "$status"
}
trap rollback ERR

sudo -u jerry git -C "$repo" merge --ff-only "$revision"
systemctl stop "$service"
stopped=1
mv "$website/dist" "$backup/dist"
switched=1
mv "$next_dist" "$website/dist"
systemctl start "$service"

ready=0
for attempt in {1..40}; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3011/ -o "$backup/health.html" && grep -q 'pw-hero-title' "$backup/health.html"; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || { echo "New website did not become healthy."; false; }
curl --fail --silent --show-error --retry 3 --retry-delay 2 --max-time 20 https://passwisely.com/ -o "$backup/public.html"
grep -q 'pw-hero-title' "$backup/public.html"
for platform in mac-arm64 mac-x64 windows-x64; do
  curl --fail --silent --show-error --head --max-time 20 "https://passwisely.com/api/download/$platform" > "$backup/download-$platform.headers"
  grep -q '/releases/v1.2.6/' "$backup/download-$platform.headers"
done
systemctl is-active --quiet "$service"
trap - ERR
echo "Website UI is live. Backup: $backup"
