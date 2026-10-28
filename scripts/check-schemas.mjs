// Validate tracked Pi config against the schemas shipped with the pinned
// development copy of Pi, so upgrades surface config drift offline.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(repo, "extensions/package.json"));
const { default: Ajv2020 } = require("ajv/dist/2020.js");
const schemas = join(
  repo,
  "extensions/node_modules/@earendil-works/pi-coding-agent/schemas",
);

const targets = [
  ["settings.json", "settings.schema.json"],
  ["keybindings.json", "keybindings.schema.json"],
  ...readdirSync(join(repo, "themes"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => [`themes/${name}`, "theme.schema.json"]),
];

// strict: false tolerates the generated schemas' annotation keywords.
const ajv = new Ajv2020({ strict: false, allErrors: true });
for (const [path, schemaName] of targets) {
  const schema = JSON.parse(readFileSync(join(schemas, schemaName), "utf8"));
  const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
  if (validate(JSON.parse(readFileSync(join(repo, path), "utf8")))) {
    console.log(`schema  ${path}`);
    continue;
  }
  for (const error of validate.errors ?? [])
    console.error(`invalid ${path}${error.instancePath}: ${error.message}`);
  process.exitCode = 1;
}
