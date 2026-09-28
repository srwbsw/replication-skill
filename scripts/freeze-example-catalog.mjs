#!/usr/bin/env node
/** Regenerate examples/canvas-export-minimal/.replication/catalog.json + catalog.hash */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = path.join(root, "examples/canvas-export-minimal");
const r = spawnSync(
  process.execPath,
  ["--import", "tsx", path.join(root, "src/cli.ts"), "catalog", "--freeze", "--cwd", example],
  { stdio: "inherit", cwd: root },
);
process.exit(r.status ?? 1);
