#!/usr/bin/env node
/**
 * install.sh host parity + adapter files + locate-replicate snippet sync.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const installSh = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const snippet = fs
  .readFileSync(path.join(root, 'scripts', 'locate-replicate.snippet.sh'), 'utf8')
  .trim();

const hostLine = installSh.match(/^HOSTS="([^"]+)"/m);
if (!hostLine) {
  console.error('FAIL: HOSTS= not found in install.sh');
  process.exit(1);
}
const hosts = hostLine[1].trim().split(/\s+/);

const adapterFiles = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
  '.cursor/rules/replication.mdc',
  '.opencode/command/replication.md',
  'commands/replication.toml',
  'gemini-extension.json',
];

const snippetConsumers = [
  'skills/AGENTS.md',
  'skills/replication/SKILL.md',
  '.cursor/rules/replication.mdc',
  '.opencode/command/replication.md',
  'commands/replication.toml',
];

let ok = true;
function pass(name) {
  console.log(`PASS [${name}]`);
}
function fail(name, detail) {
  console.error(`FAIL [${name}]${detail ? `: ${detail}` : ''}`);
  ok = false;
}

for (const h of hosts) {
  const hasInstall = new RegExp(`if want ${h};`).test(installSh);
  const hasUninstall =
    h === 'claude' || h === 'codex' || h === 'copilot' || h === 'gemini' || h === 'agy' || h === 'cmd'
      ? new RegExp(`want ${h}`).test(installSh.slice(0, installSh.indexOf('# ─────────────────────────────── INSTALL')))
      : new RegExp(`if want ${h};`).test(installSh.slice(0, installSh.indexOf('# ─────────────────────────────── INSTALL')));

  if (!hasInstall) fail(`host ${h}`, 'missing install block');
  else pass(`host ${h} install block`);

  if (!hasUninstall) fail(`host ${h}`, 'missing uninstall coverage');
  else pass(`host ${h} uninstall coverage`);
}

for (const rel of adapterFiles) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) fail(`adapter file ${rel}`, 'missing');
  else pass(`adapter file ${rel}`);
}

for (const rel of snippetConsumers) {
  const body = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!body.includes(snippet)) fail(`snippet sync ${rel}`, 'does not contain canonical snippet');
  else pass(`snippet sync ${rel}`);
}

process.exit(ok ? 0 : 1);
