#!/usr/bin/env bash
# 三端同步：本地 Mac → wise → GitHub（个人 + 公司），只做 fast-forward。
# 用法：在本地仓库运行 scripts/sync-three-way.sh [分支名，默认当前分支]
# 环境变量：WISE_SSH（默认 wise）、WISE_REPO（默认 /home/jerry/codebase/passwisely）
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
wise_ssh="${WISE_SSH:-wise}"
wise_repo="${WISE_REPO:-/home/jerry/codebase/passwisely}"
branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
[[ "$branch" != "HEAD" ]] || { echo "处于 detached HEAD，请指定分支名。" >&2; exit 1; }

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "本地有未提交的修改，请先提交。" >&2
  exit 1
fi
sha="$(git rev-parse "refs/heads/$branch")"
echo "同步分支 $branch @ $sha"

# 1. 把提交送到 wise 的临时引用（不直接推送到已检出的分支）。
git push --quiet "$wise_ssh:$wise_repo" "$sha:refs/sync/incoming" --force

# 2. 在 wise 上 fast-forward 分支，并推送到两个 GitHub 仓库。
ssh "$wise_ssh" bash -s -- "$wise_repo" "$branch" "$sha" <<'REMOTE'
set -euo pipefail
repo="$1"; branch="$2"; sha="$3"
cd "$repo"
current="$(git rev-parse --abbrev-ref HEAD)"
if git show-ref --verify --quiet "refs/heads/$branch"; then
  old="$(git rev-parse "refs/heads/$branch")"
  if ! git merge-base --is-ancestor "$old" "$sha"; then
    echo "wise 上的 $branch ($old) 不是 $sha 的祖先：已分叉，停止同步。" >&2
    exit 2
  fi
fi
if [[ "$current" == "$branch" ]]; then
  git diff --quiet && git diff --cached --quiet || { echo "wise 工作区有未提交的修改，停止同步。" >&2; exit 3; }
  git merge --ff-only --quiet "$sha"
else
  git update-ref "refs/heads/$branch" "$sha"
fi
for remote in origin previous-origin; do
  git push --quiet "$remote" "$sha:refs/heads/$branch"
done
git update-ref -d refs/sync/incoming
echo "wise:            $(git rev-parse "refs/heads/$branch")"
for remote in origin previous-origin; do
  echo "$remote ($(git remote get-url "$remote")): $(git ls-remote "$remote" "refs/heads/$branch" | cut -f1)"
done
REMOTE

echo "local:           $sha"
