#!/bin/bash
set -euo pipefail

export STEP_AGENT_ROOT="/home/ec2-user/stepsecurity"
export STEP_API_KEY_ROLE_ARN="arn:aws:iam::300960356742:role/jatin-secret-reader-role"
export STEP_API_KEY_SECRET_REGION="us-west-2"
export STEP_API="https://int.api.stepsecurity.io/v1"
export STEP_TELEMETRY_URL="https://int.app-api.stepsecurity.io/v1"

export STEP_ARTIFACTORY_BASE="https://stepsecurity.jfrog.io/artifactory"
export STEP_ARTIFACTORY_REPO="jatin-repo1"

readonly CURL_CONNECT_TIMEOUT_SECONDS=10
readonly CURL_MAX_TIME_SECONDS=60

agent_base_dir="${STEP_AGENT_ROOT%/}/gha-hooks"
script_name="$(basename "$0")"
hook_mode="post"

if [[ "${script_name}" == pre.sh ]]; then
  hook_mode="pre"
fi

current_hook="${agent_base_dir}/${hook_mode}.js"

log() {
  printf '[StepSecurity] %s\n' "$*"
}

warn() {
  log "WARN: $*"
}

mkdir -p "${agent_base_dir}"

refresh_hooks_from_artifactory() {
  local tmp_dir search_response hook_lines

  for required_cmd in curl jq sha256sum node; do
    if ! command -v "${required_cmd}" >/dev/null 2>&1; then
      warn "missing required command: ${required_cmd}; skipping hook refresh"
      return 0
    fi
  done

  if ! tmp_dir="$(mktemp -d)"; then
    warn "failed to create temporary directory; skipping hook refresh"
    return 0
  fi

  cleanup() {
    rm -rf "${tmp_dir}"
  }

  trap cleanup RETURN
  search_response="${tmp_dir}/artifactory-search.json"

  log "refreshing hooks from Artifactory repo ${STEP_ARTIFACTORY_REPO}"

  if ! curl -fsSL \
    --connect-timeout "${CURL_CONNECT_TIMEOUT_SECONDS}" \
    --max-time "${CURL_MAX_TIME_SECONDS}" \
    -H "X-Result-Detail: properties,info" \
    "${STEP_ARTIFACTORY_BASE%/}/api/search/prop?ss.serving=true&ss.gha-hook=true&repos=${STEP_ARTIFACTORY_REPO}" \
    -o "${search_response}"; then
    warn "failed to query Artifactory; keeping current staged hooks"
    return 0
  fi

  if ! hook_lines="$(jq -r '
    reduce .results[] as $item ({};
      if ($item.path | endswith("/pre.js") or endswith("/post.js")) then
        ($item.path | split("/") | last) as $name
        | if (.[$name] == null or .[$name].created < $item.created) then
            .[$name] = $item
          else
            .
          end
      else
        .
      end
    )
    | to_entries[]
    | [.key, .value.downloadUri, .value.checksums.sha256]
    | @tsv
  ' "${search_response}")"; then
    warn "failed to parse Artifactory response; keeping current staged hooks"
    return 0
  fi

  if [[ -z "${hook_lines}" ]]; then
    warn "Artifactory returned no staged hook assets; keeping current staged hooks"
    return 0
  fi

  while IFS=$'\t' read -r hook_name download_uri expected_sha256; do
    local downloaded_hook staged_hook downloaded_sha256 staged_sha256

    [[ -n "${hook_name}" ]] || continue
    if [[ -z "${download_uri}" || -z "${expected_sha256}" ]]; then
      warn "skipping ${hook_name:-unknown hook}; missing download URI or checksum"
      continue
    fi

    downloaded_hook="${tmp_dir}/${hook_name}"
    staged_hook="${agent_base_dir}/${hook_name}"

    log "downloading ${hook_name} from ${download_uri}"
    if ! curl -fsSL \
      --connect-timeout "${CURL_CONNECT_TIMEOUT_SECONDS}" \
      --max-time "${CURL_MAX_TIME_SECONDS}" \
      "${download_uri}" \
      -o "${downloaded_hook}"; then
      warn "failed to download ${hook_name}; keeping current staged copy"
      continue
    fi

    if ! downloaded_sha256="$(sha256sum "${downloaded_hook}" | awk '{print $1}')"; then
      warn "failed to calculate checksum for ${hook_name}; keeping current staged copy"
      continue
    fi
    if [[ "${downloaded_sha256}" != "${expected_sha256}" ]]; then
      warn "checksum mismatch for ${hook_name}; expected ${expected_sha256}, got ${downloaded_sha256}; keeping current staged copy"
      continue
    fi

    if [[ ! -f "${staged_hook}" ]]; then
      if ! cp "${downloaded_hook}" "${staged_hook}"; then
        warn "failed to stage new ${hook_name}; keeping current staged copy"
        continue
      fi
      log "staged new ${hook_name}"
      continue
    fi

    if ! staged_sha256="$(sha256sum "${staged_hook}" | awk '{print $1}')"; then
      warn "failed to calculate staged checksum for ${hook_name}; keeping current staged copy"
      continue
    fi
    if [[ "${staged_sha256}" != "${downloaded_sha256}" ]]; then
      if ! cp "${downloaded_hook}" "${staged_hook}"; then
        warn "failed to update staged ${hook_name}; keeping current staged copy"
        continue
      fi
      log "updated staged ${hook_name}"
      continue
    fi

    log "${hook_name} unchanged"
  done <<<"${hook_lines}"

  return 0
}

if [[ "${hook_mode}" == "pre" ]]; then
  refresh_hooks_from_artifactory
fi

if [[ ! -f "${current_hook}" ]]; then
  warn "missing staged hook: ${current_hook}; skipping execution"
  exit 0
fi

log "executing ${current_hook}"
if ! node "${current_hook}"; then
  warn "hook execution failed for ${current_hook}; exiting 0"
  exit 0
fi
