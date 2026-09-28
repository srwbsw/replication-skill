import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packageRoot(): string {
  return PKG_ROOT;
}

export function schemaPath(name: "replication.config" | "catalog" | "routes"): string {
  return path.join(PKG_ROOT, "schemas", `${name}.schema.json`);
}

export function resolveFromCwd(cwd: string, relative: string): string {
  return path.resolve(cwd, relative);
}

export function replicationDir(cwd: string, outputDir: string): string {
  return resolveFromCwd(cwd, outputDir);
}

export function catalogPath(repDir: string): string {
  return path.join(repDir, "catalog.json");
}

export function catalogHashPath(repDir: string): string {
  return path.join(repDir, "catalog.hash");
}

export function configPath(repDir: string): string {
  return path.join(repDir, "replication.config.json");
}

export function routesPath(repDir: string): string {
  return path.join(repDir, "routes.json");
}
