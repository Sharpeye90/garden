#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/k2-env.sh"

load_k2_env
k2_export_terraform_env

TF_DIR="$ROOT/infra/k2/terraform"
export TF_CLI_CONFIG_FILE="$TF_DIR/terraformrc"
APP_IP="$(terraform -chdir="$TF_DIR" output -raw app_private_ip)"
APP_URL="$(terraform -chdir="$TF_DIR" output -raw app_url)"
TF_SSH_USER="$(terraform -chdir="$TF_DIR" output -raw ssh_user)"
SSH_USER="${K2_DEPLOY_SSH_USER:-$TF_SSH_USER}"
DATABASE_URL="$(terraform -chdir="$TF_DIR" output -raw database_url)"

GARDEN_TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$GARDEN_TMP_DIR"
}
trap cleanup EXIT

ARCHIVE="$GARDEN_TMP_DIR/garden-rhythm.tar.gz"
RUNTIME_ENV="$GARDEN_TMP_DIR/garden.env"

COPYFILE_DISABLE=1 tar \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.next' \
  --exclude='.vinext' \
  --exclude='.wrangler' \
  --exclude='.terraform' \
  --exclude='*.tfstate' \
  --exclude='*.tfstate.*' \
  --exclude='node_modules' \
  --exclude='dist' \
  -czf "$ARCHIVE" \
  -C "$ROOT" .

{
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL"
  printf 'DATABASE_POOL_SIZE=%s\n' "${DATABASE_POOL_SIZE:-8}"
  printf 'GARDEN_SINGLE_USER_KEY=%s\n' "${GARDEN_SINGLE_USER_KEY:-garden-owner}"
  printf 'GARDEN_SINGLE_USER_NAME=%s\n' "${GARDEN_SINGLE_USER_NAME:-Садовод}"
} > "$RUNTIME_ENV"
chmod 600 "$RUNTIME_ENV"

SSH_OPTIONS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
PRIVATE_KEY="$(k2_ssh_private_key_path || true)"
if [[ -n "$PRIVATE_KEY" ]]; then
  SSH_OPTIONS+=(-i "$PRIVATE_KEY")
fi

echo "Deploying Garden Rhythm to $APP_URL"
scp "${SSH_OPTIONS[@]}" "$ARCHIVE" "$RUNTIME_ENV" "$SSH_USER@$APP_IP:/tmp/"

ssh "${SSH_OPTIONS[@]}" "$SSH_USER@$APP_IP" 'bash -s' <<'REMOTE'
set -euo pipefail

release_dir="/opt/garden/releases/$(date -u +%Y%m%d%H%M%S)"
sudo mkdir -p "$release_dir"
sudo chown -R "$USER:$USER" /opt/garden
tar -xzf /tmp/garden-rhythm.tar.gz -C "$release_dir"
mv /tmp/garden.env /opt/garden/garden.env
chmod 600 /opt/garden/garden.env
ln -sfn "$release_dir" /opt/garden/current

cd /opt/garden/current
sudo docker compose -p garden-rhythm -f docker-compose.k2.yml --env-file /opt/garden/garden.env up -d --build --remove-orphans

for attempt in {1..40}; do
  if curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null; then
    sudo docker compose -p garden-rhythm -f docker-compose.k2.yml ps
    exit 0
  fi
  sleep 3
done

echo "Garden Rhythm health check did not become ready in time" >&2
sudo docker compose -p garden-rhythm -f docker-compose.k2.yml logs --tail=160 app >&2
exit 1
REMOTE

echo "Garden Rhythm is available through VPN: $APP_URL"
