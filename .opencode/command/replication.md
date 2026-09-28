---
description: Closed-world UI replication and parity — replicate CLI (catalog, freeze, compare, surplus)
---

User request: $ARGUMENTS

Follow the **replication** closed-world workflow. Use the `replicate` CLI; do not discover routes outside `catalog.json`.

## 1. Resolve the runner

```bash
REPLICATE_SCRIPT="${REPLICATION_CLI:-$(command -v replicate || true)}"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/.local/bin/replicate"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/bin/replicate"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/.replication-skill/bin/replicate.js"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$HOME/plugins/replication-skill/bin/replicate.js"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$(printf '%s\n' "$HOME"/.claude/plugins/cache/replication-skill/replication-skill/*/bin/replicate.js 2>/dev/null | grep -v '\*' | sort -V | tail -1)"
[ -x "$REPLICATE_SCRIPT" ] || REPLICATE_SCRIPT="$PWD/bin/replicate.js"
```

If not executable, stop and tell the user to run `install.sh` from https://github.com/srwbsw/replication-skill and `pnpm build` in the clone.

## 2. Execute

Read `skills/replication/SKILL.md` from the replication-skill checkout or plugin cache. Run the phases the user asked for (`init`, `catalog --freeze`, `catalog --check`, `compare`, `surplus`, …) with `"$REPLICATE_SCRIPT"` and `--cwd` set to the target workspace. Deep docs: `skills/replication/references/`.

## 3. Output

Parse the last `REPLICATION_RESULT:` line on stdout; honor exit codes.
