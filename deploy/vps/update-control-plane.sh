#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-/opt/computercraft-agents}"
service_name="${CONTROL_PLANE_SERVICE:-computercraft-agents-control-plane.service}"
health_url="${CONTROL_PLANE_HEALTH_URL:-http://172.18.0.1:8787/healthz}"

fail() {
  printf 'update-control-plane: %s\n' "$1" >&2
  exit 1
}

[[ -d "$repo_dir/.git" ]] || fail "not a Git checkout: $repo_dir"
cd "$repo_dir"

[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean; commit or remove local changes first"

commit="$(git rev-parse --verify HEAD)"
printf 'Validating control-plane checkout %s\n' "$commit"
npm ci
npm run check

printf 'Restarting %s\n' "$service_name"
sudo systemctl restart "$service_name"

for attempt in $(seq 1 30); do
  if sudo systemctl is-active --quiet "$service_name" &&
    curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then
    printf 'Control plane is healthy at commit %s\n' "$commit"
    exit 0
  fi
  sleep 1
done

fail "service did not become healthy; inspect systemctl status and journald before retrying"
