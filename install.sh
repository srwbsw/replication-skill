#!/usr/bin/env bash
# replication-skill installer (pattern: second-agent-skill install.sh)
#
#   curl -fsSL …/install.sh | bash
#   ./install.sh --help
#
# Links the Cursor skill and optionally puts `replicate` on PATH.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_SRC="${REPO_DIR}/skills/replication"
CURSOR_SKILLS="${HOME}/.cursor/skills"
BIN_TARGET="${HOME}/.local/bin/replicate"
LINK_SKILL=1
LINK_BIN=1

for arg in "$@"; do
  case "$arg" in
    --no-skill) LINK_SKILL=0 ;;
    --no-bin) LINK_BIN=0 ;;
    --help | -h)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (see --help)" >&2
      exit 1
      ;;
  esac
done

if [[ "$LINK_SKILL" -eq 1 ]]; then
  mkdir -p "$CURSOR_SKILLS"
  ln -sfn "$SKILL_SRC" "${CURSOR_SKILLS}/replication"
  echo "Linked skill → ${CURSOR_SKILLS}/replication"
fi

if [[ "$LINK_BIN" -eq 1 ]]; then
  mkdir -p "$(dirname "$BIN_TARGET")"
  chmod +x "${REPO_DIR}/bin/replicate.js"
  ln -sfn "${REPO_DIR}/bin/replicate.js" "$BIN_TARGET"
  echo "Linked CLI → $BIN_TARGET"
  echo "Run: pnpm build in ${REPO_DIR} before using replicate outside pnpm replicate"
fi

echo "Done."
