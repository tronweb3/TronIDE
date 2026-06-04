#!/usr/bin/env bash
#
# TronLink Git Hooks Setup
# Usage: bash .githooks/setup.sh
#
# Sets up git hooks for automated code review and security auditing.
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${CYAN}[setup]${NC} $*"; }
ok()    { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
error() { echo -e "${RED}[setup]${NC} $*"; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  TronLink Git Hooks Setup                    ║"
echo "║  Fast Security Checks + Optional AI Review   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── Check we're in the repo root ───────────────────────────────────────────
# Skip gracefully (exit 0) when there is no .git directory. This script runs from
# postinstall, so it must not fail installs in CI, Docker, or when the package is
# installed as a dependency without a git checkout.
if [ ! -d ".git" ]; then
    warn "No .git directory found (CI/Docker/dependency install) — skipping git hook setup."
    exit 0
fi

# ─── Configure git to use .githooks directory ───────────────────────────────
info "Configuring git to use .githooks/ as hooks directory..."
git config core.hooksPath .githooks
ok "core.hooksPath set to .githooks/"

# ─── Make hooks executable ──────────────────────────────────────────────────
info "Setting executable permissions on hooks..."
chmod +x .githooks/pre-commit
ok "pre-commit hook is executable"

# ─── Verify .gitignore ─────────────────────────────────────────────────────
if grep -q '.security-reports' .gitignore 2>/dev/null; then
    ok ".security-reports/ already in .gitignore"
else
    warn ".security-reports/ not found in .gitignore — please add it manually"
fi

# ─── Check for Claude Code CLI ──────────────────────────────────────────────
if command -v claude &>/dev/null; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    ok "Claude Code CLI found (${CLAUDE_VERSION})"
else
    warn "Claude Code CLI not installed."
    warn "The pre-commit hook will skip AI review without it."
    warn "Install: npm install -g @anthropic-ai/claude-code"
    warn "Docs: https://docs.anthropic.com/en/docs/claude-code"
fi

# ─── Verify skills exist ───────────────────────────────────────────────────
if [ -f ".claude/skills/security-code-review.md" ] && [ -f ".claude/skills/code-quality-review.md" ]; then
    ok "Claude Code skills found:"
    echo "    - .claude/skills/security-code-review.md"
    echo "    - .claude/skills/code-quality-review.md"
else
    warn "Claude Code skills not found in .claude/skills/"
    warn "The pre-commit hook may not work correctly without them."
fi

# ─── Done ───────────────────────────────────────────────────────────────────
echo ""
ok "=========================================="
ok "  Setup complete!                         "
ok "=========================================="
echo ""
echo "What happens now:"
echo "  - Every 'git commit' will automatically run:"
echo "    1. Quick local pattern scan (hardcoded keys, eval, .env files)"
echo "    2. Blocking on fast critical findings"
echo ""
echo "  - AI review is opt-in:"
echo "      PRE_COMMIT_AI_REVIEW=1 git commit ..."
echo "      bash .githooks/pre-commit --ai"
echo ""
echo "  - AI reports are saved to .security-reports/ when enabled"
echo ""
echo "  - To skip hooks (not recommended):"
echo "    git commit --no-verify"
echo ""
