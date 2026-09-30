#!/usr/bin/env bash
#
# Pull the latest code and restart GeoCache SF on an EC2 box set up by
# ec2-setup.sh. For a private repo, pass a token:
#
#   export GITHUB_TOKEN='github_pat_...'
#   sudo -E bash /opt/geocache/deploy/update.sh
#
# Set DEPLOY_SHA to deploy one exact commit instead of the tip of GIT_REF (the
# auto-deploy uses this to ship the commit CI tested, or to roll back).
#
set -euo pipefail

APP_DIR="/opt/geocache"
DATA_DIR="/var/lib/geocache"
APP_USER="geocache"
GIT_REF="${GIT_REF:-main}"
DEPLOY_SHA="${DEPLOY_SHA:-}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo -E bash ${APP_DIR}/deploy/update.sh)" >&2
  exit 1
fi

REPO_URL="$(git -C "$APP_DIR" remote get-url origin)"
# The token (if any) is only used in the fetch URL, so it is never written to
# .git/config, even if a step fails.
CLONE_URL="$REPO_URL"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@${REPO_URL#https://}"
fi

REF="${DEPLOY_SHA:-$GIT_REF}"
echo "==> Fetching ${REF}"
git -C "$APP_DIR" fetch --depth 1 "$CLONE_URL" "$REF"
git -C "$APP_DIR" reset --hard FETCH_HEAD

echo "==> Rebuilding"
cd "$APP_DIR"
npm ci
npm run build
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

echo "==> Restarting service"
systemctl restart geocache
echo "==> Done. Logs: sudo journalctl -u geocache -f"
