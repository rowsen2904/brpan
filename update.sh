#!/usr/bin/env bash
# Pull the latest code from GitHub and rebuild. Keeps .env and data/ (both gitignored).
set -euo pipefail

cd "$(dirname "$0")"
if [ "$(id -u)" -ne 0 ]; then exec sudo "$0" "$@"; fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
echo "==> Updating BRPAN (branch ${BRANCH})"

git fetch --all --quiet
# Local source edits are discarded in favour of the committed code; .env and data/ are
# gitignored, so your config and database are kept.
git reset --hard "origin/${BRANCH}"

echo "==> Rebuilding containers"
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true

echo "==> Now at:"
git log --oneline -1
echo "Done. Logs: docker compose logs -f brpan"
