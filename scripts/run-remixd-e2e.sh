#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
temp_root=${TMPDIR:-/tmp}
temp_root=${temp_root%/}
temp_root=$(cd "$temp_root" && pwd -P)
remixd_workspace=$(mktemp -d "${temp_root}/tronide-remixd-e2e.XXXXXX")
service_pids=()

terminate_tree () {
  local pid=$1
  local child
  local children

  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    terminate_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup () {
  local status=$?
  local pid

  trap - EXIT INT TERM
  for pid in "${service_pids[@]}"; do
    terminate_tree "$pid"
  done
  for pid in "${service_pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  case "$remixd_workspace" in
    "${temp_root}"/tronide-remixd-e2e.*)
      rm -rf -- "$remixd_workspace"
      ;;
    *)
      echo "Refusing to remove unexpected remixd workspace: ${remixd_workspace}" >&2
      status=1
      ;;
  esac

  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp -R "${repo_root}/apps/remix-ide/contracts/." "$remixd_workspace/"
git -C "$remixd_workspace" init --quiet
export REMIXD_E2E_FOLDER=$remixd_workspace

cd "$repo_root"

pnpm selenium &
service_pids+=("$!")
pnpm serve:e2e &
service_pids+=("$!")
pnpm remixd:e2e &
service_pids+=("$!")

pnpm e2e:remixd:wait-and-run

# Assert the browser operations crossed the real websocket boundary and
# reached disk. UI-only assertions can otherwise pass against a cached tree.
grep --fixed-strings --quiet 'contract test1Changed' "$remixd_workspace/folder1/contract1.sol"
test -f "$remixd_workspace/folder1/renamed_contract_chrome.sol"
test ! -e "$remixd_workspace/folder1/contract_chrome.sol"
test ! -e "$remixd_workspace/folder1/contract_chrome_toremove.sol"
echo "remixd filesystem mutations persisted to the isolated fixture"
