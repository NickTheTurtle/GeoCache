#!/usr/bin/env bash
#
# Install the GeoCache auto-deploy timer on a box set up by ec2-setup.sh.
# Every 2 minutes it deploys main once CI has passed on it (see auto-deploy.sh).
#
#   sudo bash /opt/geocache/deploy/install-auto-deploy.sh
#   # private repo only: sudo GITHUB_TOKEN='github_pat_...' bash /opt/geocache/deploy/install-auto-deploy.sh
#
# Turn it off:  sudo systemctl disable --now geocache-auto-deploy.timer
#
set -euo pipefail

APP_DIR="/opt/geocache"
ENV_FILE="/etc/geocache-deploy.env"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo bash ${APP_DIR}/deploy/install-auto-deploy.sh)" >&2
  exit 1
fi
if [[ ! -f "${APP_DIR}/deploy/auto-deploy.sh" ]]; then
  echo "${APP_DIR}/deploy/auto-deploy.sh not found. Update ${APP_DIR} first (deploy/update.sh)." >&2
  exit 1
fi

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  (umask 077; echo "GITHUB_TOKEN=${GITHUB_TOKEN}" > "$ENV_FILE")
  echo "Saved GITHUB_TOKEN to ${ENV_FILE} (root-only)."
fi

cat > /etc/systemd/system/geocache-auto-deploy.service <<EOF
[Unit]
Description=GeoCache auto-deploy (ships main once CI passes)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-${ENV_FILE}
ExecStart=/bin/bash ${APP_DIR}/deploy/auto-deploy.sh
# A deploy rebuilds the app, which takes a few minutes on a small instance.
TimeoutStartSec=30min
EOF

cat > /etc/systemd/system/geocache-auto-deploy.timer <<EOF
[Unit]
Description=Check for a new CI-passed GeoCache commit every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now geocache-auto-deploy.timer

cat <<EOF

Auto-deploy is on. Merged PRs go live a few minutes after CI passes on main.

  Status:   systemctl list-timers geocache-auto-deploy.timer
  Logs:     sudo journalctl -u geocache-auto-deploy -e
  Run now:  sudo systemctl start geocache-auto-deploy
  Turn off: sudo systemctl disable --now geocache-auto-deploy.timer
EOF
