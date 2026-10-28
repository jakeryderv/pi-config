// Git clean filter for settings.json: Pi writes per-installation identifiers
// into the global settings, which must stay out of this (public) repository.
// The working copy keeps them; only the committed version is stripped.
import { readFileSync } from "node:fs";

const localKeys = ["deviceId", "trackingId"];

const input = readFileSync(0, "utf8");
let settings;
try {
  settings = JSON.parse(input);
} catch {
  // Leave invalid JSON untouched; check-json reports it.
  process.stdout.write(input);
  process.exit(0);
}
for (const key of localKeys) delete settings[key];
// Match Pi's own formatting (two-space indent, no trailing newline).
process.stdout.write(JSON.stringify(settings, null, 2));
