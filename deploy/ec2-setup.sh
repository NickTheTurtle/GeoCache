#!/usr/bin/env bash
#
# GeoCache SF — one-shot EC2 (Ubuntu 24.04) deployment.
#
# Installs Node + Caddy, checks out the app to /opt/geocache, builds it, runs it
# as a hardened systemd service on 127.0.0.1:3000, and puts Caddy in front for
# automatic HTTPS. HTTPS is required so the in-app QR camera scanner works
# (getUserMedia needs a secure context). If you don't pass a DOMAIN we default to
# a free "<public-ip>.sslip.io" hostname, which still gets a real Let's Encrypt
# certificate — no domain purchase needed.
#
# Usage (run as root, from a checkout of this repo so the script is present):
#
#   export ADMIN_PASSWORD='pick-a-strong-password'   # required
#   export GITHUB_TOKEN='github_pat_...'             # required only if the repo is private
#   # optional overrides:
#   #   export DOMAIN='geocache.example.com'         # your own domain (point its DNS A record at this box first)
#   #   export ACME_EMAIL='you@example.com'          # for Let's Encrypt expiry notices
#   #   export GIT_REF='main'
#   sudo -E bash deploy/ec2-setup.sh
#
set -euo pipefail

# ---- config / params -------------------------------------------------------
REPO_URL="${REPO_URL:-https://github.com/NickTheTurtle/GeoCache.git}"
GIT_REF="${GIT_REF:-main}"
APP_DIR="/opt/geocache"
DATA_DIR="/var/lib/geocache"
ENV_FILE="/etc/geocache.env"
APP_USER="geocache"
NODE_MAJOR="24"
PORT="3000"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (use: sudo -E bash deploy/ec2-setup.sh)" >&2
  exit 1
fi
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_PASSWORD is required. Re-run with:  export ADMIN_PASSWORD='...'  then sudo -E bash deploy/ec2-setup.sh" >&2
  exit 1
fi

log() { echo -e "\n\033[1;36m==>\033[0m $*"; }

# ---- discover the public IP / domain --------------------------------------
log "Discovering public address"
# IMDSv2 first (works on EC2), then fall back to a public echo service.
PUBLIC_IP=""
TOKEN="$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)"
if [[ -n "$TOKEN" ]]; then
  PUBLIC_IP="$(curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
fi
[[ -z "$PUBLIC_IP" ]] && PUBLIC_IP="$(curl -sf https://api.ipify.org 2>/dev/null || true)"
[[ -z "$PUBLIC_IP" ]] && PUBLIC_IP="$(curl -sf https://ifconfig.me 2>/dev/null || true)"

DOMAIN="${DOMAIN:-}"
if [[ -z "$DOMAIN" ]]; then
  if [[ -z "$PUBLIC_IP" ]]; then
    echo "Could not determine the public IP and no DOMAIN was provided." >&2
    exit 1
  fi
  DOMAIN="${PUBLIC_IP}.sslip.io"
fi
PUBLIC_URL="https://${DOMAIN}"
log "Using domain: ${DOMAIN}  (public IP: ${PUBLIC_IP:-unknown})"

# ---- base packages ---------------------------------------------------------
log "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg rsync debian-keyring debian-archive-keyring apt-transport-https

# ---- Node.js (NodeSource) --------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  log "Node.js already present: $(node -v)"
fi

# ---- Caddy (official apt repo) --------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  log "Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
else
  log "Caddy already present: $(caddy version)"
fi

# ---- app user + directories ------------------------------------------------
log "Creating service user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"

# ---- fetch the code --------------------------------------------------------
CLONE_URL="$REPO_URL"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  # Inject the token only for the network operation; the stored remote stays clean.
  CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@${REPO_URL#https://}"
fi

if [[ -d "$APP_DIR/.git" ]]; then
  log "Updating existing checkout in ${APP_DIR}"
  git -C "$APP_DIR" remote set-url origin "$CLONE_URL"
  git -C "$APP_DIR" fetch --depth 1 origin "$GIT_REF"
  git -C "$APP_DIR" checkout -f "$GIT_REF"
  git -C "$APP_DIR" reset --hard "origin/${GIT_REF}"
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
else
  log "Cloning ${REPO_URL} (ref ${GIT_REF}) into ${APP_DIR}"
  git clone --depth 1 --branch "$GIT_REF" "$CLONE_URL" "$APP_DIR"
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"   # scrub token from .git/config
fi

# ---- build -----------------------------------------------------------------
log "Installing dependencies and building"
cd "$APP_DIR"
npm ci
npm run build

# node:sqlite needs the --experimental-sqlite flag on some Node versions but is
# stable (no flag) on others. Detect what this Node needs.
SQLITE_OPT=""
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  if node --experimental-sqlite -e "require('node:sqlite')" >/dev/null 2>&1; then
    SQLITE_OPT="--experimental-sqlite"
  fi
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

# ---- environment file ------------------------------------------------------
log "Writing ${ENV_FILE}"
umask 077
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=${PORT}
DATA_DIR=${DATA_DIR}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PUBLIC_BASE_URL=${PUBLIC_URL}
ORIGIN=${PUBLIC_URL}
# Allow larger hint-image uploads (adapter-node defaults to 512 KB).
BODY_SIZE_LIMIT=10485760
EOF
[[ -n "$SQLITE_OPT" ]] && echo "NODE_OPTIONS=${SQLITE_OPT}" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"

# ---- systemd service -------------------------------------------------------
log "Installing systemd service"
cat > /etc/systemd/system/geocache.service <<EOF
[Unit]
Description=GeoCache SF
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
# Hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable geocache
systemctl restart geocache

# ---- Caddy reverse proxy + auto HTTPS -------------------------------------
log "Configuring Caddy for ${DOMAIN}"
{
  if [[ -n "${ACME_EMAIL:-}" ]]; then
    echo "{"
    echo "    email ${ACME_EMAIL}"
    echo "}"
  fi
  echo "${DOMAIN} {"
  echo "    encode zstd gzip"
  echo "    reverse_proxy 127.0.0.1:${PORT}"
  echo "}"
} > /etc/caddy/Caddyfile

systemctl enable caddy
systemctl restart caddy

# ---- done ------------------------------------------------------------------
sleep 2
log "Deployment complete!"
cat <<EOF

  App URL:      ${PUBLIC_URL}
  Admin:        ${PUBLIC_URL}/admin
  Data (SQLite):${DATA_DIR}/geocache.db

  Service:      sudo systemctl status geocache
  App logs:     sudo journalctl -u geocache -f
  Caddy logs:   sudo journalctl -u caddy -f

  Make sure your EC2 Security Group allows inbound 80 and 443 from anywhere
  (and 22 from your IP). The first HTTPS request may take a few seconds while
  Caddy obtains the certificate.

  To update later:  sudo -E bash ${APP_DIR}/deploy/update.sh
EOF
