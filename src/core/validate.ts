import fs from "node:fs";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import { schemaPath } from "../paths.js";

const Ajv2020 = Ajv2020Import as unknown as new (opts?: object) => {
  compile(schema: object): ValidateFunction;
};
const ajv = new Ajv2020({ allErrors: true, strict: false });
(addFormatsImport as unknown as (instance: typeof ajv) => void)(ajv);

const validators = new Map<string, ValidateFunction>();

function loadSchema(name: "replication.config" | "catalog" | "routes") {
  const schema = JSON.parse(fs.readFileSync(schemaPath(name), "utf8")) as Record<string, unknown>;
  delete schema.$schema;
  delete schema.$id;
  return schema;
}

function getValidator(name: "replication.config" | "catalog" | "routes") {
  let v = validators.get(name);
  if (!v) {
    v = ajv.compile(loadSchema(name));
    validators.set(name, v);
  }
  return v!;
}

export function validateReplicationConfig(data: unknown): string[] {
  return formatErrors(getValidator("replication.config")(data), getValidator("replication.config").errors);
}

export function validateCatalog(data: unknown): string[] {
  return formatErrors(getValidator("catalog")(data), getValidator("catalog").errors);
}

export function validateRoutes(data: unknown): string[] {
  return formatErrors(getValidator("routes")(data), getValidator("routes").errors);
}

function formatErrors(ok: boolean | Promise<unknown>, errors?: ErrorObject[] | null): string[] {
  if (ok) return [];
  if (!errors?.length) return ["Unknown schema validation error"];
  return errors.map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}
