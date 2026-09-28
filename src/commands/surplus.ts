import fs from "node:fs";
import { loadConfig } from "../io/config.js";
import { catalogPath, replicationDir } from "../paths.js";
import { printReplicationResult } from "../core/result.js";
import { loadCatalog } from "./compare.js";
import { catalogTargetPathKeys, normalizePathKey } from "../parity/urls.js";

export interface SurplusOptions {
  cwd: string;
  routesFile?: string;
  writeReport?: boolean;
}

export interface TargetRoutesFile {
  schemaVersion: 1;
  routes: string[];
}

export function runSurplus(opts: SurplusOptions): number {
  const config = loadConfig(opts.cwd);
  const repDir = replicationDir(opts.cwd, config.outputDir);
  const catalog = loadCatalog(repDir);
  const allowed = catalogTargetPathKeys(catalog, config.target.localePrefix);

  const routesPath =
    opts.routesFile ??
    config.target.routesFile ??
    `${repDir}/target-routes.json`;

  if (!fs.existsSync(routesPath)) {
    console.error(
      `Missing ${routesPath}. List every public implementation path (no host), then re-run surplus.`,
    );
    console.error("Example: { \"schemaVersion\": 1, \"routes\": [\"/\", \"/signup\", \"/demo\"] }");
    printReplicationResult({ command: "surplus", exit: 1, error: "missing_target_routes" });
    return 1;
  }

  const data = JSON.parse(fs.readFileSync(routesPath, "utf8")) as TargetRoutesFile;
  const implemented = data.routes.map(normalizePathKey);
  const surplus = implemented.filter((p) => !allowed.has(p));

  console.log(`Catalog paths (in-scope): ${allowed.size}`);
  console.log(`Implemented paths listed: ${implemented.length}`);
  if (surplus.length === 0) {
    console.log("surplus: none — every listed route is in the catalog.");
  } else {
    console.log("surplus routes (in implementation, not in design catalog):");
    for (const p of surplus) console.log(`  ${p}`);
  }

  if (opts.writeReport) {
    const reportDir = `${repDir}/reports`;
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
      `${reportDir}/surplus.json`,
      `${JSON.stringify({ surplus, allowed: [...allowed].sort(), implemented }, null, 2)}\n`,
      "utf8",
    );
  }

  const exit = surplus.length === 0 ? 0 : 2;
  printReplicationResult({
    command: "surplus",
    exit,
    surplusCount: surplus.length,
    catalogPaths: allowed.size,
  });
  return exit;
}
