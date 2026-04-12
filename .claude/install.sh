#!/usr/bin/env bash
# Install the Vault-Kit agent schema into ~/.claude so every Claude Code
# session on this machine inherits the orchestrated core/bench/dynamic setup.
#
# Usage (from the repo root):
#   ./.claude/install.sh
#
# Re-running is safe: existing files are overwritten with the current kit.
# Project-local .claude/agents/ files still override user-global ones by name,
# so per-project customization is preserved.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${HOME}/.claude"
AGENTS_SRC="${REPO_ROOT}/.claude/agents"
CLAUDE_MD_SRC="${REPO_ROOT}/CLAUDE.md"

if [[ ! -d "${AGENTS_SRC}" ]]; then
  echo "error: ${AGENTS_SRC} not found. Run this from the Vault-Kit repo root." >&2
  exit 1
fi

echo "Installing agent kit to ${TARGET_DIR}/"

mkdir -p "${TARGET_DIR}/agents"
cp "${AGENTS_SRC}"/*.md "${TARGET_DIR}/agents/"

# Install the portable part of CLAUDE.md (everything above the "## Project overlay"
# marker). Project-specific notes stay in the per-repo CLAUDE.md.
if [[ -f "${CLAUDE_MD_SRC}" ]]; then
  overlay_line="$(grep -n '^## Project overlay' "${CLAUDE_MD_SRC}" | head -n 1 | cut -d: -f1 || true)"
  if [[ -n "${overlay_line:-}" ]]; then
    # Strip the blank line and horizontal rule immediately above the marker.
    end_line=$((overlay_line - 3))
    head -n "${end_line}" "${CLAUDE_MD_SRC}" > "${TARGET_DIR}/CLAUDE.md"
  else
    cp "${CLAUDE_MD_SRC}" "${TARGET_DIR}/CLAUDE.md"
  fi
fi

echo
echo "Installed:"
echo "  ${TARGET_DIR}/CLAUDE.md  (portable orchestration policy)"
ls "${TARGET_DIR}/agents" | sed 's|^|  '"${TARGET_DIR}"'/agents/|'
echo
echo "Done. Every new Claude Code session on this machine will now see these agents."
echo "Project-local .claude/agents/ files still override these by name."
