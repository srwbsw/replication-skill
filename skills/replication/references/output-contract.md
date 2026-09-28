# Output contract

Inspired by second-agent's `SECOND_OPINION_RESULT` tail line.

After each command, the CLI prints human-readable lines, then **exactly one** JSON line on stdout:

```
REPLICATION_RESULT: {"command":"catalog","exit":0,"screens":12,"catalogHash":"abc…"}
```

Agents should:

1. Read stdout (or log file when added later).
2. Parse the **last** line matching `^REPLICATION_RESULT: `.
3. Treat `exit` in JSON as the command outcome (mirrors process exit code when present).

Fields are command-specific; unknown keys should be ignored. Future commands (`report`, `gate`) will add `slug`, `verdict`, `ssim`, etc.
