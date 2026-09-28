import fs from "node:fs";
import { configPath, replicationDir } from "../paths.js";
import type { ReplicationConfig } from "../adapters/types.js";
import { validateReplicationConfig } from "../core/validate.js";
import { normalizeReplicationConfig } from "./normalize-config.js";

export function loadConfig(cwd: string, outputDir?: string): ReplicationConfig {
  const repDir = replicationDir(cwd, outputDir ?? ".replication");
  const file = configPath(repDir);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Run: replicate init --adapter canvas-export --entry <path>`);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = validateReplicationConfig(data);
  if (errors.length > 0) {
    throw new Error(`Invalid replication.config.json:\n${errors.join("\n")}`);
  }
  return normalizeReplicationConfig(data as ReplicationConfig);
}

export function writeConfig(cwd: string, config: ReplicationConfig): string {
  const repDir = replicationDir(cwd, config.outputDir);
  fs.mkdirSync(repDir, { recursive: true });
  const file = configPath(repDir);
  const normalized = normalizeReplicationConfig(config);
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return file;
}
