#!/usr/bin/env bash
#
# GeoCache auto-deploy: ship the tip of main to this box once CI has passed.
#
# Run every 2 minutes by geocache-auto-deploy.timer (install it with
# deploy/install-auto-deploy.sh). Each run:
#   1. Compares main on GitHub with the commit checked out in /opt/geocache.
#   2. If main moved, looks up the CI workflow run for that exact commit.
#      Still running: try again next time. Failed: skip that commit for good.
#   3. On success, deploys that exact commit with update.sh, then checks the
#      site answers. If the deploy or the check fails, it rolls back to the
#      previous commit.
#
# Pull-based on purpose: the box needs no inbound SSH from GitHub and no
# deploy secrets in the repo. For a private repo, put GITHUB_TOKEN=... in
# /etc/geocache-deploy.env (read by the systemd unit).
#
# Logs: sudo journalctl -u geocache-auto-deploy -e
#
set -euo pipefail

# Overridable for testing.
APP_DIR="${APP_DIR:-/opt/geocache}"
BRANCH="${BRANCH:-main}"
WORKFLOW="${WORKFLOW:-ci.yml}"
STATE_DIR="${STATE_DIR:-/var/lib/geocache-deploy}"
UPDATE_SCRIPT="${UPDATE_SCRIPT:-$APP_DIR/deploy/update.sh}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
HEALTH_URLS="${HEALTH_URLS:-http://127.0.0.1:3000/ http://127.0.0.1:3000/heist}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
export GIT_TERMINAL_PROMPT=0   # never hang waiting for credentials

log() { echo "[auto-deploy] $*"; }

# owner/repo from the checkout's origin URL (https or ssh form).
repo_slug() {
  local url
  url="$(git -C "$APP_DIR" remote get-url origin)"
  url="${url#https://github.com/}"
  url="${url#git@github.com:}"
  echo "${url%.git}"
}

remote_url() {
  local slug="$1"
  if [[ -n "${REMOTE_URL:-}" ]]; then
    echo "$REMOTE_URL"
  elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo "https://x-access-token:${GITHUB_TOKEN}@github.com/${slug}.git"
  else
    echo "https://github.com/${slug}.git"
  fi
}

# Prints "<status> <conclusion>" for the latest CI run on this commit, from a
# push to BRANCH, or "none none" if there isn't one yet.
ci_state() {
  local slug="$1" sha="$2"
  local auth=()
  [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  curl -fsS --max-time 20 "${auth[@]}" -H "Accept: application/vnd.github+json" \
    "${GITHUB_API}/repos/${slug}/actions/workflows/${WORKFLOW}/runs?branch=${BRANCH}&event=push&head_sha=${sha}&per_page=1" \
    | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const run = (JSON.parse(s).workflow_runs || [])[0];
        console.log(run ? `${run.status} ${run.conclusion || "none"}` : "none none");
      });'
}

healthy() {
  local url code
  for ((i = 0; i < HEALTH_TRIES; i++)); do
    local ok=1
    for url in $HEALTH_URLS; do
      code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$url" || true)"
      [[ "$code" == 200 ]] || ok=0
    done
    ((ok)) && return 0
    sleep 2
  done
  return 1
}

# Deploy one exact commit. update.sh is copied out first because the deploy
# rewrites the checkout it lives in.
deploy_sha() {
  local sha="$1" tmp rc=0
  tmp="$(mktemp)"
  cp "$UPDATE_SCRIPT" "$tmp"
  DEPLOY_SHA="$sha" bash "$tmp" || rc=$?
  rm -f "$tmp"
  ((rc == 0)) || return "$rc"
  [[ "$(git -C "$APP_DIR" rev-parse HEAD)" == "$sha" ]]
}

main() {
  mkdir -p "$STATE_DIR"
  exec 9>"$STATE_DIR/lock"
  if ! flock -n 9; then
    log "Another deploy is still running; skipping."
    return 0
  fi

  local slug remote current state
  slug="$(repo_slug)"
  remote="$(git ls-remote "$(remote_url "$slug")" "refs/heads/${BRANCH}" | cut -f1)"
  if [[ -z "$remote" ]]; then
    log "Could not read ${BRANCH} from GitHub; will retry."
    return 1
  fi
  current="$(git -C "$APP_DIR" rev-parse HEAD)"
  [[ "$remote" == "$current" ]] && return 0
  if [[ -e "$STATE_DIR/failed-$remote" ]]; then
    return 0   # already rejected; wait for a newer commit
  fi

  state="$(ci_state "$slug" "$remote")" || { log "Could not query CI for ${remote:0:7}; will retry."; return 1; }
  case "$state" in
    "completed success") ;;
    completed\ *)
      log "CI did not pass for ${remote:0:7} (${state#completed }); not deploying it."
      touch "$STATE_DIR/failed-$remote"
      return 0 ;;
    *)
      if [[ ! -e "$STATE_DIR/waiting-$remote" ]]; then
        log "${remote:0:7} is on ${BRANCH}; waiting for CI (${state})."
        touch "$STATE_DIR/waiting-$remote"
      fi
      return 0 ;;
  esac

  log "Deploying ${remote:0:7} (was ${current:0:7})"
  if deploy_sha "$remote" && healthy; then
    echo "$remote" > "$STATE_DIR/last-deployed"
    rm -f "$STATE_DIR"/waiting-*
    log "Deployed ${remote:0:7}."
    return 0
  fi

  log "Deploy of ${remote:0:7} failed; rolling back to ${current:0:7}."
  touch "$STATE_DIR/failed-$remote"
  if deploy_sha "$current" && healthy; then
    log "Rolled back to ${current:0:7}."
  else
    log "ROLLBACK FAILED. The site may be down. Check: sudo journalctl -u geocache -e"
  fi
  return 1
}

main "$@"
