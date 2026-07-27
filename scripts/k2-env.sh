#!/usr/bin/env bash
set -euo pipefail

garden_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$script_dir/.." && pwd
}

load_k2_env() {
  local root env_file line key value
  root="$(garden_repo_root)"
  env_file="${K2_ENV_FILE:-$root/.env}"

  if [[ ! -f "$env_file" ]]; then
    echo "Missing K2 environment file: $env_file" >&2
    return 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "${line:0:1}" == "#" || "$line" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done < "$env_file"
}

resolve_k2_ssh_key_for_terraform() {
  local key="$1"
  if [[ "$key" == "~/"* ]]; then
    key="$HOME/${key#~/}"
  fi

  if [[ -f "$key" ]]; then
    if [[ "$key" == *.pub ]]; then
      sed -n '1p' "$key"
    elif [[ -f "$key.pub" ]]; then
      sed -n '1p' "$key.pub"
    else
      printf '%s' "$1"
    fi
  else
    printf '%s' "$1"
  fi
}

k2_export_terraform_env() {
  : "${K2_ACCESS_KEY:?K2_ACCESS_KEY is required}"
  : "${K2_SECRET_KEY:?K2_SECRET_KEY is required}"
  : "${K2_REGION:?K2_REGION is required}"
  : "${K2_VPC_ID:?K2_VPC_ID is required}"
  : "${K2_SUBNET_ID:?K2_SUBNET_ID is required}"
  : "${K2_SSH_KEY:?K2_SSH_KEY is required}"

  export AWS_ACCESS_KEY_ID="$K2_ACCESS_KEY"
  export AWS_SECRET_ACCESS_KEY="$K2_SECRET_KEY"
  export AWS_REGION="$K2_REGION"
  export AWS_DEFAULT_REGION="$K2_REGION"
  export TF_VAR_region="$K2_REGION"
  export TF_VAR_vpc_id="$K2_VPC_ID"
  export TF_VAR_subnet_id="$K2_SUBNET_ID"
  export TF_VAR_admin_cidrs="${K2_ADMIN_CIDR:-}"
  export TF_VAR_ssh_key
  TF_VAR_ssh_key="$(resolve_k2_ssh_key_for_terraform "$K2_SSH_KEY")"

  [[ -n "${K2_NAME_PREFIX:-}" ]] && export TF_VAR_name_prefix="$K2_NAME_PREFIX"
  [[ -n "${K2_DEPLOY_SSH_USER:-}" ]] && export TF_VAR_ssh_user="$K2_DEPLOY_SSH_USER"
  [[ -n "${K2_APP_AMI_ID:-}" ]] && export TF_VAR_app_ami_id="$K2_APP_AMI_ID"
  [[ -n "${K2_APP_INSTANCE_TYPE:-}" ]] && export TF_VAR_app_instance_type="$K2_APP_INSTANCE_TYPE"
  [[ -n "${K2_POSTGRES_INSTANCE_TYPE:-}" ]] && export TF_VAR_postgres_instance_type="$K2_POSTGRES_INSTANCE_TYPE"
  [[ -n "${K2_POSTGRES_VERSION:-}" ]] && export TF_VAR_postgres_version="$K2_POSTGRES_VERSION"
  return 0
}

k2_ssh_private_key_path() {
  if [[ -n "${K2_SSH_PRIVATE_KEY_PATH:-}" ]]; then
    printf '%s' "$K2_SSH_PRIVATE_KEY_PATH"
    return 0
  fi

  local key="${K2_SSH_KEY:-}"
  if [[ "$key" == "~/"* ]]; then
    key="$HOME/${key#~/}"
  fi
  if [[ -f "$key" && "$key" != *.pub ]]; then
    printf '%s' "$key"
  fi
}
