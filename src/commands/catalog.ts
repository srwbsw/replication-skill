import fs from "node:fs";
import type { ReplicationAdapter } from "../adapters/adapter.js";
import { getAdapter } from "../adapters/registry.js";
import type { CatalogDocument } from "../adapters/types.js";
import { hashCatalogDocument } from "../core/hash.js";
import { validateCatalog } from "../core/validate.js";
import { loadConfig } from "../io/config.js";
import { printReplicationResult } from "../core/result.js";
import { catalogHashPath, catalogPath, replicationDir } from "../paths.js";

export interface CatalogOptions {
  cwd: string;
  freeze?: boolean;
  check?: boolean;
}

/** True when the on-disk catalog document is still in the pre-generic (v1) shape. */
function isLegacyV1CatalogShape(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const record = doc as Record<string, unknown>;
  if (record.schemaVersion === 1) return true;
  const screens = record.screens;
  const first = Array.isArray(screens)
    ? (screens[0] as Record<string, unknown> | undefined)
    : undefined;
  if (first && typeof first === "object") {
    if ("referenceSubdir" in first || "rootLocator" in first) return true;
    if (!("designPath" in first)) return true;
  }
  return false;
}

/**
 * `adapterOverride` is a test-only escape hatch for injecting a fake ReplicationAdapter without
 * going through the (fixed, hard-coded) adapter registry — real callers never pass it.
 *
 * The ReplicationAdapter contract (src/adapters/adapter.ts) allows buildCatalog to return either
 * a catalog directly or a Promise of one. A synchronous adapter's result is handled inline, so
 * runCatalog returns a plain `number`, exactly as before. An asynchronous adapter's result is
 * awaited, so runCatalog returns a `Promise<number>` instead — callers (src/cli.ts) must check
 * which one they got back.
 */
export function runCatalog(
  opts: CatalogOptions,
  adapterOverride?: ReplicationAdapter,
): number | Promise<number> {
  const config = loadConfig(opts.cwd);
  const repDir = replicationDir(opts.cwd, config.outputDir);

  const adapter = adapterOverride ?? getAdapter(config.adapter);
  const buildResult = adapter.buildCatalog(opts.cwd, config);
  if (buildResult instanceof Promise) {
    return buildResult.then((resolved) => finishCatalog(opts, repDir, resolved));
  }
  return finishCatalog(opts, repDir, buildResult);
}

function finishCatalog(
  opts: CatalogOptions,
  repDir: string,
  buildResult: { catalog: CatalogDocument; warnings: string[] },
): number {
  const { catalog, warnings } = buildResult;

  const errors = validateCatalog(catalog);
  if (errors.length > 0) {
    console.error("Generated catalog failed schema validation:");
    for (const e of errors) console.error(`  - ${e}`);
    printReplicationResult({ command: "catalog", exit: 1, error: "schema_invalid" });
    return 1;
  }

  for (const w of warnings) {
    console.warn(`warning: ${w}`);
  }

  const hash = hashCatalogDocument(catalog);
  const outFile = catalogPath(repDir);
  const hashFile = catalogHashPath(repDir);

  if (opts.check) {
    if (!fs.existsSync(outFile)) {
      console.error(`Missing ${outFile}. Run: replicate catalog --freeze`);
      printReplicationResult({ command: "catalog", exit: 1, mode: "check", error: "missing_catalog" });
      return 1;
    }
    const existing = JSON.parse(fs.readFileSync(outFile, "utf8")) as unknown;
    if (isLegacyV1CatalogShape(existing)) {
      console.error(
        "Catalog on disk is in the old v1 shape (schemaVersion 1 / referenceSubdir, missing designPath) and can't be checked against the current v2 schema.",
      );
      console.error("Re-run: replicate catalog --freeze");
      printReplicationResult({ command: "catalog", exit: 2, mode: "check", error: "legacy_v1_shape" });
      return 2;
    }
    const existingHash = hashCatalogDocument(existing);
    const frozenHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim() : "";
    if (existingHash !== hash) {
      console.error("Catalog drift: source/definitions changed. Re-run catalog --freeze.");
      console.error(`  computed: ${hash}`);
      console.error(`  on disk:  ${existingHash}`);
      printReplicationResult({
        command: "catalog",
        exit: 2,
        mode: "check",
        error: "drift",
        catalogHash: hash,
      });
      return 2;
    }
    if (frozenHash && frozenHash !== hash) {
      console.error("catalog.hash mismatch. Re-run catalog --freeze.");
      printReplicationResult({ command: "catalog", exit: 2, mode: "check", error: "hash_file_mismatch" });
      return 2;
    }
    console.log(`catalog OK (${catalog.screens.length} screens, hash ${hash.slice(0, 12)}…)`);
    printReplicationResult({
      command: "catalog",
      exit: 0,
      mode: "check",
      screens: catalog.screens.length,
      catalogHash: hash,
    });
    return 0;
  }

  if (!opts.freeze) {
    console.log(JSON.stringify(catalog, null, 2));
    console.error("");
    console.error(`(${catalog.screens.length} screens; use --freeze to write ${outFile})`);
    printReplicationResult({
      command: "catalog",
      exit: 0,
      mode: "stdout",
      screens: catalog.screens.length,
      catalogHash: hash,
    });
    return 0;
  }

  fs.mkdirSync(repDir, { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  fs.writeFileSync(hashFile, `${hash}\n`, "utf8");
  console.log(`Wrote ${outFile}`);
  console.log(`Wrote ${hashFile} (${hash})`);
  console.log(`Screens: ${catalog.screens.map((s) => s.slug).join(", ")}`);
  printReplicationResult({
    command: "catalog",
    exit: 0,
    mode: "freeze",
    screens: catalog.screens.length,
    catalogHash: hash,
    slugs: catalog.screens.map((s) => s.slug),
  });
  return 0;
}
