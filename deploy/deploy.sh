#!/usr/bin/env bash
# Deploys a tested commit on the server: fast-forward, restart, health check, rollback on failure.
# Runs as the forced command of the deploy SSH key (the commit arrives in SSH_ORIGINAL_COMMAND)
# or by hand: deploy/deploy.sh <commit-sha>   (without an argument: origin/main).
set -euo pipefail

service=media-reflection
cd "$(dirname "$0")/.."

git fetch --quiet origin main
ref=${1:-${SSH_ORIGINAL_COMMAND:-origin/main}}
if [[ $ref != origin/main && ! $ref =~ ^[0-9a-f]{40}$ ]]; then
  echo "Очікується повний sha коміту або origin/main, отримано: $ref" >&2
  exit 2
fi
target=$(git rev-parse --verify "$ref^{commit}")
previous=$(git rev-parse HEAD)

if git merge-base --is-ancestor "$target" "$previous"; then
  echo "Сервер уже містить ${target:0:7} (на ${previous:0:7}), пропускаю."
  exit 0
fi

install_deps() {
  if ! git diff --quiet "$1" "$2" -- package.json package-lock.json; then
    echo "Залежності змінились, npm ci --omit=dev"
    npm ci --omit=dev
  fi
}

# Safety copy of the database: a rollback of code cannot undo a schema migration.
if [ -f data/media.sqlite ]; then
  node scripts/db-snapshot.mjs data/media.sqlite data/media.sqlite.pre-deploy
fi

echo "Оновлюю ${previous:0:7} -> ${target:0:7}"
git merge --ff-only "$target"
install_deps "$previous" "$target"
sudo -n systemctl restart "$service"

sleep 15
if systemctl is-active --quiet "$service"; then
  echo "Готово: $service працює на ${target:0:7}."
  exit 0
fi

echo "Сервіс не піднявся, відкат на ${previous:0:7}" >&2
journalctl -u "$service" -n 30 --no-pager >&2 || true
git reset --hard "$previous"
install_deps "$target" "$previous"
sudo -n systemctl restart "$service"
sleep 5
systemctl is-active "$service" >&2 || true
exit 1
