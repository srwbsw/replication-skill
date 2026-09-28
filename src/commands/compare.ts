import fs from "node:fs";
import { chromium } from "playwright";
import type { CatalogDocument, ReplicationConfig } from "../adapters/types.js";
import { loadConfig } from "../io/config.js";
import { catalogPath, replicationDir } from "../paths.js";
import { printReplicationResult } from "../core/result.js";
import { diffTrees } from "../parity/diff-trees.js";
import { extractDomTree, rootSelectorForScreen } from "../parity/dom-extract.js";
import { designUrlForScreen, targetUrlForScreen } from "../parity/urls.js";
import { resolveViewport } from "../parity/viewport.js";

export interface CompareOptions {
  cwd: string;
  designUrl?: string;
  targetUrl?: string;
  slug?: string;
  viewport?: string;
  maxDiffs?: number;
  writeReport?: boolean;
}

export interface ScreenCompareResult {
  slug: string;
  designUrl: string;
  targetUrl: string;
  diffCount: number;
  diffs: ReturnType<typeof diffTrees>;
  passed: boolean;
}

/**
 * SSIM/pixel-diff comparison is not implemented anywhere in this codebase — `compare` only does
 * DOM-tree + computed-style diffing (see diffTrees). A configured per-screen `thresholds.ssim`
 * is therefore currently a silent no-op. Surface that honestly instead of staying quiet about it.
 */
export function ssimNotEnforcedWarnings(screens: CatalogDocument["screens"]): string[] {
  return screens
    .filter((s) => s.thresholds?.ssim !== undefined)
    .map(
      (s) =>
        `screen "${s.slug}" sets thresholds.ssim (${s.thresholds!.ssim}) but this version of ` +
        `replicate does not implement SSIM/pixel-diff comparison yet — the threshold is not enforced.`,
    );
}

export function loadCatalog(repDir: string): CatalogDocument {
  const file = catalogPath(repDir);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Run: replicate catalog --freeze`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as CatalogDocument;
}

export function resolveEndpoints(
  config: ReplicationConfig,
  flags: { designUrl?: string; targetUrl?: string },
): { designUrl: string; targetUrl: string; localePrefix?: string } {
  const designUrl = flags.designUrl ?? config.design?.baseUrl;
  const targetUrl = flags.targetUrl ?? config.target.baseUrl;
  if (!designUrl) {
    throw new Error(
      "Design base URL required: set design.baseUrl in replication.config.json or pass --design-url",
    );
  }
  if (!targetUrl) {
    throw new Error("Target base URL required: set target.baseUrl or pass --target-url");
  }
  return {
    designUrl,
    targetUrl,
    localePrefix: config.target.localePrefix,
  };
}

export async function compareScreen(
  designPageUrl: string,
  targetPageUrl: string,
  screen: CatalogDocument["screens"][number],
  viewport: { width: number; height: number },
  maxDiffs: number,
): Promise<ScreenCompareResult> {
  const browser = await chromium.launch();
  try {
    const designPage = await browser.newPage({ viewport });
    const targetPage = await browser.newPage({ viewport });
    const root = rootSelectorForScreen(screen);
    await designPage.goto(designPageUrl, { waitUntil: "networkidle", timeout: 120_000 });
    await targetPage.goto(targetPageUrl, { waitUntil: "networkidle", timeout: 120_000 });
    const expected = await extractDomTree(designPage, root);
    const actual = await extractDomTree(targetPage, root);
    const diffs = diffTrees(expected, actual, maxDiffs);
    return {
      slug: screen.slug,
      designUrl: designPageUrl,
      targetUrl: targetPageUrl,
      diffCount: diffs.length,
      diffs,
      passed: diffs.length === 0,
    };
  } finally {
    await browser.close();
  }
}

export async function runCompare(opts: CompareOptions): Promise<number> {
  const config = loadConfig(opts.cwd);
  const repDir = replicationDir(opts.cwd, config.outputDir);
  const catalog = loadCatalog(repDir);
  const endpoints = resolveEndpoints(config, {
    designUrl: opts.designUrl,
    targetUrl: opts.targetUrl,
  });
  const viewport = resolveViewport(config.viewports, opts.viewport ?? "desktop");
  const maxDiffs = opts.maxDiffs ?? 40;

  const screens = catalog.screens.filter((s) => s.status === "in-scope" && s.buildable);
  const selected = opts.slug ? screens.filter((s) => s.slug === opts.slug) : screens;
  if (opts.slug && selected.length === 0) {
    throw new Error(`Unknown or out-of-scope slug: ${opts.slug}`);
  }

  for (const w of ssimNotEnforcedWarnings(selected)) {
    console.warn(`warning: ${w}`);
  }

  const results: ScreenCompareResult[] = [];
  for (const screen of selected) {
    const designPageUrl = designUrlForScreen(endpoints.designUrl, screen);
    const targetPageUrl = targetUrlForScreen(
      endpoints.targetUrl,
      screen.livePath,
      endpoints.localePrefix,
    );
    console.log(`compare ${screen.slug}`);
    console.log(`  design: ${designPageUrl}`);
    console.log(`  target: ${targetPageUrl}`);
    const result = await compareScreen(
      designPageUrl,
      targetPageUrl,
      screen,
      viewport,
      maxDiffs,
    );
    results.push(result);
    if (!result.passed) {
      for (const d of result.diffs.slice(0, 8)) {
        console.error(`  ${d.kind} @ ${d.path}${d.property ? ` (${d.property})` : ""}`);
      }
      if (result.diffs.length > 8) {
        console.error(`  … and ${result.diffs.length - 8} more`);
      }
    }
  }

  const failed = results.filter((r) => !r.passed);
  if (opts.writeReport) {
    const reportDir = `${repDir}/reports`;
    fs.mkdirSync(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      `${reportDir}/compare-${stamp}.json`,
      `${JSON.stringify({ viewport, results }, null, 2)}\n`,
      "utf8",
    );
  }

  const exit = failed.length === 0 ? 0 : 1;
  printReplicationResult({
    command: "compare",
    exit,
    screens: results.length,
    failed: failed.length,
    viewport: viewport.width,
  });
  return exit;
}
