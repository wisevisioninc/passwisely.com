#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "$(git -C "$repo_dir" status --porcelain)" ]]; then
  echo "The local repository has uncommitted changes. Commit or stash them before syncing." >&2
  exit 1
fi

git -C "$repo_dir" fetch wise main
git -C "$repo_dir" merge --ff-only wise/main
git -C "$repo_dir" push origin main
