#!/usr/bin/env bash

set -euo pipefail

ide_url="${E2E_BASE_URL:-http://127.0.0.1:18080}"
default_selenium_status_url="http://127.0.0.1:4444/wd/hub/status"
if [[ "${DIRECT_CHROMEDRIVER:-false}" == "true" ]]; then
  default_selenium_status_url="http://127.0.0.1:4444/status"
fi
selenium_status_url="${SELENIUM_STATUS_URL:-$default_selenium_status_url}"
ready_timeout_seconds="${E2E_READY_TIMEOUT_SECONDS:-180}"
ready_interval_seconds="${E2E_READY_INTERVAL_SECONDS:-1}"

if [[ ! "$ready_timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "E2E_READY_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 64
fi

wait_for_service () {
  local name=$1
  local url=$2
  local deadline=$((SECONDS + ready_timeout_seconds))

  until curl --fail --silent --show-error --max-time 5 "$url" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for ${name} at ${url}" >&2
      exit 1
    fi
    sleep "$ready_interval_seconds"
  done

  echo "${name} is ready at ${url}"
}

wait_for_service "TRON IDE" "${ide_url%/}/"
wait_for_service "Selenium" "$selenium_status_url"

exec pnpm e2e:golden:run
