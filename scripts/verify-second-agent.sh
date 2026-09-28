#!/usr/bin/env bash
# Sequential second-agent reviews (avoids fusion wedging). macOS-friendly timeouts.
set -uo pipefail

REVIEW_SCRIPT="${SECOND_AGENT_REVIEW:-}"
if [[ -z "$REVIEW_SCRIPT" || ! -x "$REVIEW_SCRIPT" ]]; then
  REVIEW_SCRIPT="$(command -v review.js 2>/dev/null || true)"
fi
if [[ ! -x "$REVIEW_SCRIPT" ]]; then
  REVIEW_SCRIPT="$HOME/.claude/plugins/cache/second-agent-skill/second-agent-skill/4.1.0/bin/review.js"
fi
if [[ ! -x "$REVIEW_SCRIPT" ]]; then
  echo "review.js not found. Install second-agent-skill or set SECOND_AGENT_REVIEW." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/.second-agent-verify"
mkdir -p "$OUT_DIR"
PROMPT='Review replication-skill generic browser parity: replicate compare (design.baseUrl + target.baseUrl, Playwright DOM/style diff per catalog slug, default 1920x1080) and replicate surplus (target-routes.json vs catalog). Critique module layout in src/parity/, config schema, pitfalls (i18n prefixes, interactive states, SSIM vs DOM). Suggest next minimal steps before gate/CI.'
TIMEOUT_SEC="${SECOND_AGENT_TIMEOUT_SEC:-600}"

run_slot() {
  local spec="$1"
  local log="${OUT_DIR}/${spec//:/-}.log"
  echo "=== ${spec} → ${log}"
  if perl -e 'alarm shift @ARGV; exec @ARGV' "$TIMEOUT_SEC" \
    "$REVIEW_SCRIPT" --engine="$spec" --cwd="$ROOT" --diff=unstaged "$PROMPT" \
    >"$log" 2>&1; then
    echo "  exit 0"
  else
    local ec=$?
    echo "  exit $ec" | tee -a "$log"
  fi
  grep -E '^(ANSWER FILE:|LOG FILE:)' "$log" 2>/dev/null || true
  local ans
  ans="$(grep -E '^ANSWER FILE:' "$log" | tail -1 | sed 's/^ANSWER FILE: //')"
  if [[ -n "$ans" && -f "$ans" ]]; then
    echo "  answer: $ans"
  fi
}

run_slot "codex:gpt-6-luna"
run_slot "agy"
run_slot "cmd"

echo ""
echo "Done. Logs in ${OUT_DIR}/"
echo "Extract envelopes: rg 'SECOND_OPINION_START' -n ${OUT_DIR}/*.log"
