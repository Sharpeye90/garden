#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/k2-env.sh"

load_k2_env
k2_export_terraform_env

TF_DIR="$ROOT/infra/k2/terraform"
export TF_CLI_CONFIG_FILE="$TF_DIR/terraformrc"
command_name="${1:-plan}"
shift || true

case "$command_name" in
  init)
    terraform -chdir="$TF_DIR" init "$@"
    ;;
  plan)
    terraform -chdir="$TF_DIR" init
    terraform -chdir="$TF_DIR" plan "$@"
    ;;
  apply)
    terraform -chdir="$TF_DIR" init
    terraform -chdir="$TF_DIR" apply "$@"
    ;;
  output)
    terraform -chdir="$TF_DIR" output "$@"
    ;;
  destroy)
    echo "Destroy is intentionally not automated. Run Terraform directly after reviewing exact resources." >&2
    exit 2
    ;;
  *)
    echo "Usage: $0 {init|plan|apply|output} [terraform arguments]" >&2
    exit 2
    ;;
esac
