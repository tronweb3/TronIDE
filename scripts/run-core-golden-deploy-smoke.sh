#!/usr/bin/env bash

set -euo pipefail

base_url="${CORE_GOLDEN_URL:-https://test.tronide.allsandlab.com/}"
base_url="${base_url%/}/"
expected_sha="${CI_COMMIT_SHA:-$(git rev-parse HEAD)}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fetch() {
  curl --fail --silent --show-error \
    --compressed \
    --retry 3 --retry-delay 1 \
    --connect-timeout 10 --max-time 45 \
    "$@"
}

fetch "${base_url}ver.txt" -o "$tmp_dir/ver.txt"
deployed_sha="$(tr -d '[:space:]' < "$tmp_dir/ver.txt")"
if [[ ! "$deployed_sha" =~ ^[0-9a-f]{7,40}$ || "$expected_sha" != "$deployed_sha"* ]]; then
  echo "Deployed commit mismatch: expected $expected_sha, received $deployed_sha" >&2
  exit 1
fi

fetch "$base_url" -o "$tmp_dir/index.html"
fetch "${base_url}release-notes.html" -o "$tmp_dir/release-notes.html"
main_src="$(grep -oE 'src="[^"]*main\.js[^"]*"' "$tmp_dir/index.html" | sed -E 's/^src="|"$//g')"
if [[ -z "$main_src" || "$main_src" == *$'\n'* ]]; then
  echo "Expected exactly one production main.js, found: $main_src" >&2
  exit 1
fi
fetch "${base_url}${main_src}" -o "$tmp_dir/main.js"

release_main_src="$(grep -oE 'src="[^"]*main\.js[^"]*"' "$tmp_dir/release-notes.html" | sed -E 's/^src="|"$//g')"
release_main_asset="${release_main_src%%\?*}"
main_asset="${main_src%%\?*}"
if [[ -z "$release_main_src" || "$release_main_src" == *$'\n'* || "$release_main_asset" != "$main_asset" ]]; then
  echo "Standalone Release Notes does not load the deployed main bundle: $release_main_src" >&2
  exit 1
fi
if ! grep -Fq 'id="release-notes-root"' "$tmp_dir/release-notes.html"; then
  echo "Standalone Release Notes root is missing" >&2
  exit 1
fi

bundle_size="$(wc -c < "$tmp_dir/main.js" | tr -d '[:space:]')"
if (( bundle_size < 1000000 )); then
  echo "Production main.js is unexpectedly small: $bundle_size bytes" >&2
  exit 1
fi

markers=(
  landingPrimaryActionsPanel
  landingAiTaskNileDeploy
  chat-wrapper-id
  releaseNotesGalleryV
  'You are running TRON IDE v'
  home-ai-task-cards.webp
  task-timeline-history.webp
  tron-skill-result.webp
  approval-write-lock.webp
  deploy-next-steps.webp
)
for marker in "${markers[@]}"; do
  if ! grep -Fq "$marker" "$tmp_dir/main.js"; then
    echo "Required P0/P1 production marker is missing: $marker" >&2
    exit 1
  fi
done

assets=(
  home-ai-task-cards.webp
  task-timeline-history.webp
  tron-skill-result.webp
  approval-write-lock.webp
  deploy-next-steps.webp
)
for asset in "${assets[@]}"; do
  size="$(fetch "${base_url}assets/img/release-notes/v2.3.3/${asset}" -o /dev/null --write-out '%{size_download}')"
  if (( size < 1000 )); then
    echo "Release Notes asset is missing or unexpectedly small: $asset ($size bytes)" >&2
    exit 1
  fi
done

printf '{"ok":true,"commit":"%s","bundleBytes":%s,"markers":%s,"releaseNoteAssets":%s,"standaloneReleaseNotes":true}\n' \
  "$deployed_sha" "$bundle_size" "${#markers[@]}" "${#assets[@]}"
