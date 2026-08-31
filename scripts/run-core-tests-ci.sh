#!/usr/bin/env bash

set -euo pipefail

cleanup() {
  rm -rf node_modules .ci-core-deps
}
trap cleanup EXIT

# The former required job installed the entire 29 GB workspace before running
# a small group of release contracts. Install only the runtime dependencies of
# the P0/P1 Node tests; production compilation remains the build job's gate.
rm -rf node_modules .ci-core-deps
mkdir -p .ci-core-deps
npm install \
  --prefix .ci-core-deps \
  --no-save \
  --package-lock=false \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  tape@4.17.0 \
  openai@6.10.0 \
  @anthropic-ai/sdk@0.70.0 \
  @google/genai@1.30.0 \
  crypto-js@4.2.0 \
  @babel/core@7.29.6 \
  @babel/register@7.28.3 \
  @babel/plugin-transform-modules-commonjs@7.27.1 \
  async@3.2.6 \
  ethereumjs-util@7.1.0 \
  ethers@5.8.0 \
  highlight.js@11.11.1 \
  highlightjs-solidity@2.0.6
ln -s .ci-core-deps/node_modules node_modules

node scripts/check-compiler-source-consistency.cjs
node scripts/check-remix-ide-entry-consistency.cjs
TRONBOX_HANDOFF_SKIP_COMPILE=1 node scripts/validate-tronbox-handoff.cjs
npm run test:core-p0-p1
