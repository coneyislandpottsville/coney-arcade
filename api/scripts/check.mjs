import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { GAMES } from "../src/registry.ts";
import { buildRegistry, validateGame } from "../src/rules.ts";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(API, "..");

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const bySchema = ajv.compile(JSON.parse(readFileSync(join(API, "games", "schema.json"), "utf8")));

let failed = false;

function report(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `\n     ${detail}` : ""}`);
  if (!ok) failed = true;
}

function jsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== "schema.json")
    .sort()
    .map((name) => join(dir, name));
}

function check(file, expectValid) {
  const label = relative(ROOT, file);
  let game;
  try {
    game = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    report(label, false, `not JSON: ${error.message}`);
    return;
  }
  const schemaOk = bySchema(game);
  const rules = validateGame(game);
  if (expectValid) {
    const detail = [
      schemaOk ? "" : `schema: ${ajv.errorsText(bySchema.errors, { separator: "; " })}`,
      rules.ok ? "" : `rules: ${rules.problems.join("; ")}`,
    ]
      .filter(Boolean)
      .join(" | ");
    report(label, schemaOk && rules.ok, detail);
  } else {
    report(label, !rules.ok, rules.ok ? "the rules accepted it" : schemaOk ? "caught by the rules alone; the schema cannot see it" : "");
  }
}

for (const file of jsonFiles(join(API, "games"))) check(file, true);
for (const file of jsonFiles(join(API, "test", "fixtures"))) check(file, true);
for (const file of jsonFiles(join(API, "test", "fixtures", "invalid"))) check(file, false);

try {
  const registry = buildRegistry(GAMES);
  const fileIds = jsonFiles(join(API, "games"))
    .map((file) => JSON.parse(readFileSync(file, "utf8")).id)
    .sort();
  const registryIds = [...registry.keys()].sort();
  const same = JSON.stringify(fileIds) === JSON.stringify(registryIds);
  report(
    `registry (${registryIds.length} game${registryIds.length === 1 ? "" : "s"})`,
    same,
    same ? "" : `registry has ${JSON.stringify(registryIds)} but api/games has ${JSON.stringify(fileIds)}`,
  );
} catch (error) {
  report("registry", false, error.message);
}

process.exit(failed ? 1 : 0);
