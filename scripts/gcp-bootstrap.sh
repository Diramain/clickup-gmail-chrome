#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_ID="clickup-gmail-multibrowser"
readonly PROJECT_NAME="ClickUp Gmail Multibrowser"

readonly CORE_SERVICES=(
  "serviceusage.googleapis.com"
  "cloudresourcemanager.googleapis.com"
  "calendar-json.googleapis.com"
  "meet.googleapis.com"
)

readonly PREVIEW_SERVICES=(
  "calendarmcp.googleapis.com"
)

readonly BLOCKED_RUNTIME_SERVICES=(
  "run.googleapis.com"
  "cloudbuild.googleapis.com"
  "artifactregistry.googleapis.com"
  "secretmanager.googleapis.com"
  "pubsub.googleapis.com"
  "billingbudgets.googleapis.com"
)

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'BLOCKED: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: bash scripts/gcp-bootstrap.sh <plan|apply|verify>

plan
  Read-only preflight. Does not create or enable anything.

apply
  External write. Requires a separate Human Gate plus:
    GCP_BOOTSTRAP_APPROVED=YES
    GCP_PARENT_KIND=organization|folder
    GCP_PARENT_ID=<numeric parent id>

verify
  Read-only verification of project, billing and service boundaries.

The script never authenticates, links billing, creates OAuth clients, stores
credentials, deploys resources or changes a region.
EOF
}

require_gcloud() {
  command -v gcloud >/dev/null 2>&1 || fail "GCLOUD_NOT_AVAILABLE"
}

require_active_identity() {
  local active_identity

  active_identity="$(
    gcloud auth list \
      --filter='status:ACTIVE' \
      --format='value(account)' \
      2>/dev/null || true
  )"

  [[ -n "${active_identity}" ]] || fail "GCLOUD_IDENTITY_NOT_AVAILABLE"
  unset active_identity
}

project_is_accessible() {
  gcloud projects describe "${PROJECT_ID}" \
    --format='value(projectId)' \
    --quiet \
    >/dev/null 2>&1
}

assert_project_name() {
  local observed_name

  observed_name="$(
    gcloud projects describe "${PROJECT_ID}" \
      --format='value(name)' \
      --quiet \
      2>/dev/null
  )" || fail "PROJECT_READ_FAILED"

  [[ "${observed_name}" == "${PROJECT_NAME}" ]] || fail "PROJECT_NAME_MISMATCH"
}

assert_billing_disabled() {
  local billing_enabled

  billing_enabled="$(
    gcloud billing projects describe "${PROJECT_ID}" \
      --format='value(billingEnabled)' \
      --quiet \
      2>/dev/null
  )" || fail "BILLING_STATE_UNAVAILABLE"

  case "${billing_enabled,,}" in
    false) ;;
    *) fail "BILLING_IS_ENABLED" ;;
  esac
}

service_is_enabled() {
  local service="$1"
  local observed

  if ! observed="$(
    gcloud services list \
      --enabled \
      --project="${PROJECT_ID}" \
      --filter="config.name=${service}" \
      --format='value(config.name)' \
      --quiet \
      2>/dev/null
  )"; then
    return 2
  fi

  [[ "${observed}" == "${service}" ]]
}

verify_required_services() {
  local service
  local status

  for service in "${CORE_SERVICES[@]}" "${PREVIEW_SERVICES[@]}"; do
    if service_is_enabled "${service}"; then
      continue
    else
      status=$?
    fi

    [[ "${status}" -eq 1 ]] || fail "SERVICE_LIST_FAILED"
    fail "REQUIRED_SERVICE_NOT_ENABLED:${service}"
  done
}

verify_blocked_services_absent() {
  local service
  local status

  for service in "${BLOCKED_RUNTIME_SERVICES[@]}"; do
    if service_is_enabled "${service}"; then
      fail "BLOCKED_RUNTIME_SERVICE_ENABLED:${service}"
    else
      status=$?
    fi

    [[ "${status}" -eq 1 ]] || fail "SERVICE_LIST_FAILED"
  done
}

show_manifest() {
  local service

  log "MODE=PLAN"
  log "PROJECT_ID=${PROJECT_ID}"
  log "PROJECT_NAME=${PROJECT_NAME}"
  log "BILLING_TARGET=DISABLED"
  log "REGION=NOT_APPLICABLE"
  log "ALLOWLISTED_SERVICES_BEGIN"
  for service in "${CORE_SERVICES[@]}" "${PREVIEW_SERVICES[@]}"; do
    log "${service}"
  done
  log "ALLOWLISTED_SERVICES_END"
  log "WRITES_PERFORMED=0"
}

plan() {
  require_gcloud
  require_active_identity
  show_manifest

  if project_is_accessible; then
    assert_project_name
    assert_billing_disabled
    log "PROJECT_STATE=ACCESSIBLE_BILLING_DISABLED"
  else
    log "PROJECT_STATE=NOT_ACCESSIBLE_OR_NOT_CREATED"
  fi

  log "PLAN_RESULT=READY_FOR_HUMAN_REVIEW"
}

parent_argument() {
  local parent_kind="${GCP_PARENT_KIND:-}"
  local parent_id="${GCP_PARENT_ID:-}"

  [[ "${parent_id}" =~ ^[0-9]+$ ]] || fail "PARENT_ID_INVALID_OR_MISSING"

  case "${parent_kind}" in
    organization) printf '%s' "--organization=${parent_id}" ;;
    folder) printf '%s' "--folder=${parent_id}" ;;
    *) fail "PARENT_KIND_INVALID_OR_MISSING" ;;
  esac
}

create_project_if_needed() {
  local parent_arg

  if project_is_accessible; then
    assert_project_name
    return
  fi

  parent_arg="$(parent_argument)"

  gcloud projects create "${PROJECT_ID}" \
    --name="${PROJECT_NAME}" \
    "${parent_arg}" \
    --quiet \
    >/dev/null 2>&1 || fail "PROJECT_CREATE_FAILED"

  project_is_accessible || fail "PROJECT_NOT_ACCESSIBLE_AFTER_CREATE"
  assert_project_name
}

enable_allowlisted_services() {
  gcloud services enable "${CORE_SERVICES[@]}" \
    --project="${PROJECT_ID}" \
    --quiet \
    >/dev/null 2>&1 || fail "CORE_SERVICE_ENABLE_FAILED"

  gcloud services enable "${PREVIEW_SERVICES[@]}" \
    --project="${PROJECT_ID}" \
    --quiet \
    >/dev/null 2>&1 || fail "CALENDAR_MCP_PREVIEW_ENABLE_FAILED"
}

apply() {
  require_gcloud
  require_active_identity
  [[ "${GCP_BOOTSTRAP_APPROVED:-}" == "YES" ]] || fail "HUMAN_GATE_NOT_PRESENT"

  create_project_if_needed
  assert_billing_disabled
  enable_allowlisted_services
  verify_required_services
  verify_blocked_services_absent
  assert_billing_disabled

  log "APPLY_RESULT=ZERO_BILLING_BASELINE_CREATED"
  log "OAUTH_AND_MCP_AUTHENTICATION=NOT_CONFIGURED"
}

verify() {
  require_gcloud
  require_active_identity
  project_is_accessible || fail "PROJECT_NOT_ACCESSIBLE"
  assert_project_name
  assert_billing_disabled
  verify_required_services
  verify_blocked_services_absent

  log "VERIFY_RESULT=ZERO_BILLING_BASELINE_VERIFIED"
  log "BILLING=DISABLED"
  log "REGIONAL_RESOURCES=NOT_CREATED_BY_THIS_SCRIPT"
}

main() {
  case "${1:-}" in
    plan) plan ;;
    apply) apply ;;
    verify) verify ;;
    -h|--help|help) usage ;;
    *) usage >&2; exit 2 ;;
  esac
}

main "$@"
