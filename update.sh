#!/usr/bin/env bash
# Pull the latest code from GitHub and rebuild. Keeps .env and data/ (both gitignored).
# The build runs detached and at low priority, so a dropped SSH session (common on small
# 1-vCPU VMs under build load) does NOT kill the rebuild — it finishes on its own.
set -euo pipefail

cd "$(dirname "$0")"
if [ "$(id -u)" -ne 0 ]; then exec sudo "$0" "$@"; fi

LOG=/var/log/brpan-update.log

# First pass: relaunch ourselves fully detached from the terminal (setsid + no stdin),
# so SIGHUP from an SSH disconnect can't abort the build.
if [ "${BRPAN_DETACHED:-}" != "1" ]; then
    : >"${LOG}"
    BRPAN_DETACHED=1 setsid nice -n 10 "$0" "$@" >"${LOG}" 2>&1 </dev/null &
    PID=$!
    echo "==> Update started in the background (PID ${PID}). Safe to lose SSH."
    echo "    Watch progress:  tail -f ${LOG}"
    echo "    When it prints 'Update complete', you're done."
    # Show live output but detach from it on Ctrl-C without killing the build.
    tail -f "${LOG}" &
    TAIL=$!
    trap 'kill ${TAIL} 2>/dev/null || true' EXIT
    while kill -0 "${PID}" 2>/dev/null; do sleep 1; done
    kill "${TAIL}" 2>/dev/null || true
    exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
echo "==> Updating BRPAN (branch ${BRANCH})"
git fetch --all --quiet
# Local source edits are discarded in favour of the committed code; .env and data/ are
# gitignored, so your config and database are kept.
git reset --hard "origin/${BRANCH}"

echo "==> Rebuilding containers (this can take a few minutes on a 1-vCPU VM)"
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true

echo "==> Now at: $(git log --oneline -1)"
echo "==> Update complete. Logs: docker compose logs -f brpan"
