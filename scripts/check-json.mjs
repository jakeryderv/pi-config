import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const paths = execFileSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    "*.json",
  ],
  { cwd: repo, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

for (const path of new Set(paths)) {
  try {
    JSON.parse(readFileSync(join(repo, path), "utf8"));
    console.log(`valid   ${path}`);
  } catch (error) {
    console.error(`invalid ${path}: ${error.message}`);
    process.exitCode = 1;
  }
}
