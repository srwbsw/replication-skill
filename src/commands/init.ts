import fs from "node:fs";
import path from "node:path";
import { packageRoot, replicationDir, routesPath } from "../paths.js";
import type { ReplicationConfig } from "../adapters/types.js";
import { printReplicationResult } from "../core/result.js";
import type { AdapterId } from "../core/adapter-id.js";
import { assertAdapterId } from "../io/normalize-config.js";
import { writeConfig } from "../io/config.js";

export interface InitOptions {
  cwd: string;
  adapter: AdapterId | string;
  entry: string;
  /** Free-form, optional description of the target stack. Not read by any command logic. */
  stack?: string;
  outputDir?: string;
  screenDefinitions?: string;
}

const DEFAULT_ROUTES = {
  schemaVersion: 1,
  handlers: {},
  parity: {},
  retired: [],
};

export function runInit(opts: InitOptions): void {
  const adapter = assertAdapterId(opts.adapter);
  const outputDir = opts.outputDir ?? ".replication";
  const repDir = replicationDir(opts.cwd, outputDir);
  fs.mkdirSync(repDir, { recursive: true });
  fs.mkdirSync(path.join(repDir, "reference", "screens"), { recursive: true });

  const config: ReplicationConfig = {
    schemaVersion: 1,
    adapter,
    source: {
      entry: opts.entry,
      ...(opts.screenDefinitions ? { screenDefinitions: opts.screenDefinitions } : {}),
    },
    design: {
      baseUrl: "http://127.0.0.1:4320",
      kind: "reference",
    },
    target: {
      ...(opts.stack ? { stack: opts.stack } : {}),
      baseUrl: "http://127.0.0.1:3000",
      routesFile: ".replication/target-routes.json",
    },
    outputDir,
    viewports: [
      { name: "desktop", width: 1920, height: 1080 },
      { name: "mobile", width: 390, height: 844 },
    ],
    catalog: { maxStates: 256 },
  };

  const configFile = writeConfig(opts.cwd, config);
  const routesFile = routesPath(repDir);
  if (!fs.existsSync(routesFile)) {
    fs.writeFileSync(routesFile, `${JSON.stringify(DEFAULT_ROUTES, null, 2)}\n`, "utf8");
  }
  const targetRoutesTpl = path.join(packageRoot(), "templates", "target-routes.json");
  const targetRoutesOut = path.join(repDir, "target-routes.json");
  if (!fs.existsSync(targetRoutesOut) && fs.existsSync(targetRoutesTpl)) {
    fs.copyFileSync(targetRoutesTpl, targetRoutesOut);
  }

  const gitignore = path.join(repDir, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, "reports/\n", "utf8");
  }

  console.log(`Wrote ${configFile}`);
  console.log(`Wrote ${routesFile}`);
  console.log("");
  console.log("Next:");
  console.log("  1. Curate screen-definitions.json and set source.screenDefinitions in config");
  console.log("  2. Map navigation handlers in routes.json from catalog.discovery");
  console.log("  3. replicate catalog --freeze --cwd <workspace>");
  printReplicationResult({ command: "init", exit: 0, adapter, outputDir });
}
