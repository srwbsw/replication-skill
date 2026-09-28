#!/usr/bin/env node
import { runCatalog } from "./commands/catalog.js";
import { runCompare } from "./commands/compare.js";
import { runInit } from "./commands/init.js";
import { runSurplus } from "./commands/surplus.js";
import { printReplicationResult } from "./core/result.js";
import { assertAdapterId } from "./io/normalize-config.js";

function printHelp(): void {
  console.log(`replicate — closed-world UI replication CLI

Commands:
  init     Scaffold .replication/ config and routes.json
  catalog  Derive catalog from source + screen definitions

  Global flags:
  --cwd <path>   Workspace directory containing .replication/ (default: process.cwd())

init:
  replicate init --adapter <canvas-export|site-crawl|url-pairs|router-migration> --entry <source-path>
                 [--stack <label>]  (free-form, optional, e.g. next-app-router|vite|rails|django)
                 [--screen-definitions <path>] [--output-dir .replication]

catalog:
  replicate catalog [--freeze] [--check]

compare (browser DOM parity at catalog-mapped URLs):
  replicate compare [--design-url <origin>] [--target-url <origin>]
                  [--slug <name>] [--viewport desktop] [--report]

surplus (implementation routes not in catalog):
  replicate surplus [--routes-file <path>] [--report]

Adapters:
  canvas-export     Single-file design-canvas export (conditional regions + navigation handlers)
  site-crawl        Bounded crawl of a live site or local dev server (any framework), no export needed
  url-pairs         Bare {slug, designPath, livePath} list — zero-discovery escape hatch
  router-migration  Finite route table from an existing app (planned)
`);
}

function parseArgs(argv: string[]): {
  command: string | null;
  flags: Record<string, string | boolean>;
} {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0] ?? null, flags };
}

function main(): void {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const cwd = typeof flags.cwd === "string" ? flags.cwd : process.cwd();

  if (!command || command === "help" || flags.help) {
    printHelp();
    process.exit(0);
  }

  try {
    if (command === "init") {
      const adapterRaw = flags.adapter as string | undefined;
      const entry = flags.entry as string | undefined;
      if (!adapterRaw || !entry) {
        console.error("init requires --adapter and --entry");
        process.exit(1);
      }
      const adapter = assertAdapterId(adapterRaw);
      runInit({
        cwd,
        adapter,
        entry,
        stack: flags.stack as string | undefined,
        outputDir: flags["output-dir"] as string | undefined,
        screenDefinitions: flags["screen-definitions"] as string | undefined,
      });
      process.exit(0);
    }

    if (command === "catalog") {
      const result = runCatalog({
        cwd,
        freeze: Boolean(flags.freeze),
        check: Boolean(flags.check),
      });
      if (result instanceof Promise) {
        result
          .then((code) => process.exit(code))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error(message);
            printReplicationResult({ command: "catalog", exit: 1, error: message });
            process.exit(1);
          });
        return;
      }
      process.exit(result);
    }

    if (command === "compare") {
      runCompare({
        cwd,
        designUrl: flags["design-url"] as string | undefined,
        targetUrl: flags["target-url"] as string | undefined,
        slug: flags.slug as string | undefined,
        viewport: flags.viewport as string | undefined,
        writeReport: Boolean(flags.report),
      })
        .then((code) => process.exit(code))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(message);
          printReplicationResult({ command: "compare", exit: 1, error: message });
          process.exit(1);
        });
      return;
    }

    if (command === "surplus") {
      const code = runSurplus({
        cwd,
        routesFile: flags["routes-file"] as string | undefined,
        writeReport: Boolean(flags.report),
      });
      process.exit(code);
    }

    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    printReplicationResult({ command: command ?? "unknown", exit: 1, error: message });
    process.exit(1);
  }
}

main();
