#!/usr/bin/env node
/**
 * PATH entry — delegates to compiled CLI or tsx dev runner.
 * See bin/AGENTS.md.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distCli = path.join(packageRoot, "dist", "cli.js");
const srcCli = path.join(packageRoot, "src", "cli.ts");
const tsxBin = path.join(packageRoot, "node_modules", ".bin", "tsx");

const userCwd = process.cwd();
const forward = process.argv.slice(2);

function hasCwdFlag(argv) {
  return argv.some((a, i) => a === "--cwd" || a.startsWith("--cwd="));
}

/** Child runs with cwd=packageRoot (for node_modules/tsx); project root is --cwd. */
const cliArgv = hasCwdFlag(forward) ? forward : ["--cwd", userCwd, ...forward];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: packageRoot, env: process.env });
  process.exit(r.status ?? 1);
}

if (fs.existsSync(distCli)) {
  run(process.execPath, [distCli, ...cliArgv]);
}

if (fs.existsSync(tsxBin)) {
  run(tsxBin, [srcCli, ...cliArgv]);
}

console.error("replicate: run `pnpm install && pnpm build` in the replication-skill checkout.");
process.exit(1);
