#!/usr/bin/env bash
# replication-skill — unified multi-harness installer (pattern: second-agent-skill).
#
# One line (review install.sh; pin --ref to a tag you trust):
#   curl -fsSL https://raw.githubusercontent.com/srwbsw/replication-skill/main/install.sh | bash
#
# Auto-detects which agent CLIs are present and installs into each:
#
#   claude   codex   cursor   opencode   gemini
#   qwen     copilot agy      kilo       cmd
#
# Symlinks `replicate` onto PATH. Safe to re-run (idempotent). Flags:
#   --only=claude,codex,cursor,opencode,gemini,qwen,copilot,agy,kilo,cmd
#   --ref=<branch|tag|sha>   git ref for the clone (default: main)
#   --uninstall              remove adapters (respects --only); full teardown when --only is omitted
#   --help

set -euo pipefail

REPO_SLUG="srwbsw/replication-skill"
PLUGIN="replication-skill"
GIT_URL="https://github.com/${REPO_SLUG}.git"
CLONE_HOME="${HOME}/.replication-skill"
CLONE_MARKER="${CLONE_HOME}/.replication-skill-managed"
XDG="${XDG_CONFIG_HOME:-$HOME/.config}"

HOSTS="claude codex cursor opencode gemini qwen copilot agy kilo cmd"

ONLY=""
REF="main"
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --only=*) ONLY="${arg#*=}" ;;
    --ref=*) REF="${arg#*=}" ;;
    --uninstall) UNINSTALL=1 ;;
    --help | -h)
      cat <<'EOF'
replication-skill — unified multi-harness installer.

One line:
  curl -fsSL https://raw.githubusercontent.com/srwbsw/replication-skill/main/install.sh | bash

Review install.sh before piping; pin --ref to a tag you trust. Cloning runs pnpm/npm
install + build (package lifecycle scripts) inside the checkout.

Hosts: claude codex cursor opencode gemini qwen copilot agy kilo cmd

Flags:
  --only=<hosts>   comma-separated subset
  --ref=<ref>      branch, tag, or commit SHA for ~/.replication-skill (default: main)
  --uninstall      remove adapters; omit --only to also remove PATH symlinks and the managed clone
  --help
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (see --help)" >&2
      exit 1
      ;;
  esac
done

want() {
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}
full_uninstall() { [ -z "$ONLY" ]; }
have() { command -v "$1" >/dev/null 2>&1; }
have_cursor() {
  have cursor || have cursor-agent || have agent || [ -d "${HOME}/.cursor" ]
}

pick_bindir() {
  for d in "$HOME/.local/bin" "$HOME/bin"; do
    case ":$PATH:" in *":$d:"*) echo "$d"; return 0 ;; esac
  done
  echo "$HOME/.local/bin"
}
BINDIR="$(pick_bindir)"

script_src() {
  local src self
  src="${BASH_SOURCE[0]:-}"
  [ -n "$src" ] || return 1
  [ -f "$src" ] || return 1
  self="$(cd "$(dirname "$src")" && pwd)" || return 1
  if [ -f "$self/bin/replicate.js" ]; then echo "$self"; return 0; fi
  return 1
}

is_managed_clone() {
  [ -f "$CLONE_MARKER" ] && [ -f "$CLONE_HOME/bin/replicate.js" ]
}

remove_managed_clone() {
  if is_managed_clone; then
    rm -rf "$CLONE_HOME"
  elif [ -d "$CLONE_HOME" ] && [ -f "$CLONE_HOME/bin/replicate.js" ] && [ -d "$CLONE_HOME/.git" ]; then
    rm -rf "$CLONE_HOME"
  fi
}

clone_or_update() {
  if [ -d "$CLONE_HOME/.git" ]; then
    git -C "$CLONE_HOME" fetch --depth 1 origin "$REF" >/dev/null 2>&1 &&
      git -C "$CLONE_HOME" checkout -q FETCH_HEAD ||
      { echo "Error: failed to update $CLONE_HOME to ref '$REF'." >&2; exit 1; }
    return 0
  fi
  if [ -e "$CLONE_HOME" ] || [ -L "$CLONE_HOME" ]; then
    if is_managed_clone; then
      rm -rf "$CLONE_HOME"
    else
      echo "Error: $CLONE_HOME exists but is not a replication-skill managed clone (missing $CLONE_MARKER)." >&2
      echo "Remove or rename it manually, then re-run install." >&2
      exit 1
    fi
  fi
  git clone --depth 1 "$GIT_URL" "$CLONE_HOME" >/dev/null 2>&1 ||
    { echo "Error: git clone failed ($GIT_URL)." >&2; exit 1; }
  git -C "$CLONE_HOME" fetch --depth 1 origin "$REF" >/dev/null 2>&1 &&
    git -C "$CLONE_HOME" checkout -q FETCH_HEAD ||
    { echo "Error: checkout ref '$REF' failed." >&2; exit 1; }
  : >"$CLONE_MARKER"
}

build_checkout() {
  local dir="$1"
  [ -f "$dir/package.json" ] || return 0
  if ! have node; then
    echo "Warning: node not found — run 'pnpm install && pnpm build' in $dir before using replicate." >&2
    return 0
  fi
  echo "Building replicate CLI in $dir …"
  if have pnpm; then
    (cd "$dir" && { pnpm install --frozen-lockfile 2>/dev/null || pnpm install; } && pnpm build)
  elif have npm; then
    (cd "$dir" && npm install && npm run build)
  else
    echo "Warning: install pnpm or npm, then build in $dir." >&2
  fi
}

remove_runner_links() {
  rm -f "$BINDIR/replicate" "$BINDIR/replicate.js"
  rm -f "$HOME/.local/bin/replicate" "$HOME/.local/bin/replicate.js"
  rm -f "$HOME/bin/replicate" "$HOME/bin/replicate.js"
}

install_claude_plugin() {
  # 1) Already registered marketplace
  if claude plugin install "${PLUGIN}@${PLUGIN}" </dev/null 2>/dev/null; then return 0; fi
  # 2) GitHub marketplace (works once default branch has .claude-plugin/)
  claude plugin marketplace add "$REPO_SLUG" </dev/null 2>/dev/null || true
  if claude plugin install "${PLUGIN}@${PLUGIN}" </dev/null 2>/dev/null; then return 0; fi
  # 3) Local checkout / managed clone (pre-merge dev, curl|bash with --ref)
  claude plugin marketplace add "$SRC" </dev/null 2>/dev/null || true
  claude plugin install "${PLUGIN}@${PLUGIN}" </dev/null 2>/dev/null
}

install_codex_plugin() {
  if codex plugin add "${PLUGIN}@${PLUGIN}" </dev/null 2>/dev/null; then return 0; fi
  codex plugin marketplace add "$REPO_SLUG" </dev/null 2>/dev/null || true
  if codex plugin add "${PLUGIN}@${PLUGIN}" </dev/null 2>/dev/null; then return 0; fi
  codex plugin marketplace add "$SRC" </dev/null 2>/dev/null || true
  codex plugin add "${PLUGIN}@${PLUGIN}" </dev/null 2>/dev/null
}

install_cmd_skill() {
  # Multi-skill repo layout: skills/replication/SKILL.md
  if cmd skills add "$REPO_SLUG" -g -f -s replication </dev/null 2>/dev/null; then return 0; fi
  cmd skills add "${REPO_SLUG}@${REF}" -g -f -s replication </dev/null 2>/dev/null
}

# ─────────────────────────────── UNINSTALL ────────────────────────────────
if [ "$UNINSTALL" -eq 1 ]; then
  echo "Uninstalling replication-skill…"
  if full_uninstall; then
    remove_runner_links
    remove_managed_clone
  fi
  if want cursor; then
    rm -f "$HOME/.cursor/rules/replication.mdc"
    rm -f "$HOME/.cursor/skills/replication"
  fi
  if want opencode; then
    rm -f "$XDG/opencode/command/replication.md"
  fi
  if want kilo; then
    rm -f "$XDG/kilo/command/replication.md"
  fi
  if want qwen; then
    rm -f "$HOME/.qwen/commands/replication.toml"
  fi
  if have claude && want claude; then
    claude plugin uninstall "$PLUGIN" 2>/dev/null || true
    claude plugin marketplace remove "$PLUGIN" 2>/dev/null || true
  fi
  if have codex && want codex; then
    codex plugin remove "${PLUGIN}@${PLUGIN}" 2>/dev/null || true
    codex plugin marketplace remove "$PLUGIN" 2>/dev/null || true
  fi
  if have copilot && want copilot; then
    copilot plugin uninstall "$PLUGIN" 2>/dev/null || true
  fi
  if have gemini && want gemini; then
    gemini extensions unlink "$PLUGIN" 2>/dev/null || true
    gemini extensions uninstall "$PLUGIN" 2>/dev/null || true
  fi
  if have agy && want agy; then
    agy plugin uninstall "$PLUGIN" 2>/dev/null || true
  fi
  if have cmd && want cmd; then
    cmd skills remove "$PLUGIN" -g -f 2>/dev/null || cmd skills remove replication -g -f 2>/dev/null || true
  fi
  echo "Done."
  exit 0
fi

# ─────────────────────────────── INSTALL ──────────────────────────────────
if SRC="$(script_src)"; then
  echo "Using local checkout: $SRC"
else
  have git || { echo "Error: git is required to install via curl|bash." >&2; exit 1; }
  echo "Cloning ${GIT_URL} (ref ${REF}) → ${CLONE_HOME}"
  clone_or_update
  [ -f "$CLONE_HOME/bin/replicate.js" ] ||
    { echo "Error: clone at $CLONE_HOME is missing bin/replicate.js." >&2; exit 1; }
  SRC="$CLONE_HOME"
fi

build_checkout "$SRC"

installed=()
skipped=()
note() { installed+=("$1"); }
skip() { skipped+=("$1"); }

mkdir -p "$BINDIR"
chmod +x "$SRC/bin/replicate.js" 2>/dev/null || true
ln -sf "$SRC/bin/replicate.js" "$BINDIR/replicate"
ln -sf "$SRC/bin/replicate.js" "$BINDIR/replicate.js"
note "runner → $BINDIR/replicate"
case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *) echo "Warning: $BINDIR is not on PATH. Set REPLICATION_CLI=$SRC/bin/replicate.js" >&2 ;;
esac

if want claude; then
  if have claude; then
    if install_claude_plugin; then
      note "claude (plugin)"
    else
      skip "claude (plugin install failed — try: claude plugin marketplace add \"\$SRC\" && claude plugin install ${PLUGIN}@${PLUGIN})"
    fi
  else skip "claude (CLI not found)"; fi
fi

if want codex; then
  if have codex; then
    if install_codex_plugin; then
      note "codex (plugin)"
    else
      skip "codex (plugin install failed — try: codex plugin marketplace add \"\$SRC\" && codex plugin add ${PLUGIN}@${PLUGIN})"
    fi
  else skip "codex (CLI not found)"; fi
fi

if want cursor; then
  if have_cursor; then
    mkdir -p "$HOME/.cursor/rules" "$HOME/.cursor/skills"
    ln -sfn "$SRC/.cursor/rules/replication.mdc" "$HOME/.cursor/rules/replication.mdc"
    ln -sfn "$SRC/skills/replication" "$HOME/.cursor/skills/replication"
    note "cursor → ~/.cursor/rules/replication.mdc + skills/replication"
  else skip "cursor (no cursor CLI or ~/.cursor)"; fi
fi

if want opencode; then
  if have opencode; then
    mkdir -p "$XDG/opencode/command"
    cp "$SRC/.opencode/command/replication.md" "$XDG/opencode/command/replication.md"
    note "opencode → $XDG/opencode/command/replication.md"
  else skip "opencode (CLI not found)"; fi
fi

if want gemini; then
  if have gemini; then
    if gemini extensions link "$SRC" --consent </dev/null 2>/dev/null; then
      note "gemini (extension link)"
    else
      skip "gemini (extensions link failed)"
    fi
  else skip "gemini (CLI not found)"; fi
fi

if want qwen; then
  if have qwen; then
    mkdir -p "$HOME/.qwen/commands"
    cp "$SRC/commands/replication.toml" "$HOME/.qwen/commands/replication.toml"
    note "qwen → ~/.qwen/commands/replication.toml"
  else skip "qwen (CLI not found)"; fi
fi

if want copilot; then
  if have copilot; then
    if copilot plugin install "$REPO_SLUG" </dev/null 2>/dev/null; then
      note "copilot (plugin)"
    else
      skip "copilot (install command failed)"
    fi
  else skip "copilot (CLI not found)"; fi
fi

if want agy; then
  if have agy; then
    if agy plugin install "$SRC" </dev/null 2>/dev/null; then
      note "agy (plugin)"
    else
      skip "agy (install command failed)"
    fi
  else skip "agy (CLI not found)"; fi
fi

if want kilo; then
  if have kilo; then
    mkdir -p "$XDG/kilo/command"
    cp "$SRC/.opencode/command/replication.md" "$XDG/kilo/command/replication.md"
    note "kilo → $XDG/kilo/command/replication.md"
  else skip "kilo (CLI not found)"; fi
fi

if want cmd; then
  if have cmd; then
    if install_cmd_skill; then
      note "cmd (skills)"
    else
      skip "cmd (skills add failed — needs GitHub ref with skills/replication; try --ref=${REF})"
    fi
  else skip "cmd (CLI not found)"; fi
fi

echo
echo "── replication-skill install summary ──"
for i in "${installed[@]}"; do echo "  ✓ $i"; done
for s in "${skipped[@]:-}"; do [ -n "$s" ] && echo "  – skipped: $s"; done
echo
echo "Runner resolves via 'command -v replicate' or REPLICATION_CLI."
echo "Trigger per harness:"
echo "  Claude/Codex/Copilot/agy/cmd: replication skill loads as plugin"
echo "  Cursor: ask to replicate UI / run closed-world parity"
echo "  opencode/kilo/gemini/qwen: run '/replication …'"
