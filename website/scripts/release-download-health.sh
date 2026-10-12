#!/usr/bin/env bash

wait_for_redirect() {
  local url="$1" expected="$2" attempts="${3:-15}" location="" attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if location=$(curl -fsSI --connect-timeout 2 --max-time 5 --output /dev/null --write-out '%{redirect_url}' "$url") && [[ "$location" == "$expected" ]]; then
      return 0
    fi
    if ((attempt < attempts)); then sleep 1; fi
  done
  echo "Download redirect did not become ready: $url; expected $expected; received ${location:-no redirect}" >&2
  return 1
}
