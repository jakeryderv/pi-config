import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const entries = [
  "AGENTS.md",
  "settings.json",
  "keybindings.json",
  "mcp.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
];

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "pi-config-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function deployment(t) {
  const home = temporaryDirectory(t);
  const agent = join(home, ".pi/agent");
  mkdirSync(agent, { recursive: true });
  mkdirSync(join(home, ".pi-lens"));
  for (const entry of entries)
    symlinkSync(join(repo, entry), join(agent, entry));
  symlinkSync(join(repo, "pi-lens.json"), join(home, ".pi-lens/config.json"));
  return { home, agent };
}

function just(home, recipe, environment = {}) {
  const result = spawnSync(
    "just",
    ["--justfile", join(repo, "justfile"), recipe],
    {
      env: { ...process.env, HOME: home, ...environment },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.ifError(result.error);
  return result;
}

test("status accepts the exact deployed links", (t) => {
  const { home } = deployment(t);
  const result = just(home, "status");
  assert.equal(result.status, 0, result.stderr);
});

for (const problem of ["missing", "wrong", "broken", "regular file"]) {
  test(`status rejects a ${problem} link`, (t) => {
    const { home, agent } = deployment(t);
    const target = join(agent, "settings.json");
    rmSync(target);
    if (problem === "wrong")
      symlinkSync(join(repo, "keybindings.json"), target);
    if (problem === "broken") symlinkSync(join(home, "nonexistent"), target);
    if (problem === "regular file") writeFileSync(target, "{}");
    const result = just(home, "status");
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /(?:absent|shadow|broken)\s+settings.json/);
  });
}

test("status rejects an incorrect Pi Lens link", (t) => {
  const { home } = deployment(t);
  const target = join(home, ".pi-lens/config.json");
  rmSync(target);
  symlinkSync(join(repo, "settings.json"), target);
  assert.notEqual(just(home, "status").status, 0);
});

test("doctor propagates deployment failures", (t) => {
  const { home, agent } = deployment(t);
  rmSync(join(agent, "settings.json"));
  const result = just(home, "doctor");
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /absent\s+settings.json/);
});

test("doctor reports missing core and configured MCP executables", (t) => {
  const { home } = deployment(t);
  const bin = join(home, "bin");
  mkdirSync(bin);
  // Only expose the tools needed to run the checks. No npm, pi, or uvx.
  for (const command of ["bash", "sh", "just", "node", "git", "readlink"]) {
    const found = spawnSync(
      "bash",
      ["-c", 'command -v "$1"', "lookup", command],
      { encoding: "utf8" },
    );
    assert.equal(found.status, 0, `missing test prerequisite: ${command}`);
    symlinkSync(found.stdout.trim(), join(bin, command));
  }
  const result = just(home, "doctor", { PATH: bin });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing executable npm/);
  assert.match(result.stderr, /missing executable pi/);
  assert.match(result.stderr, /missing MCP executable uvx/);
});

test("JSON validation includes new configs and excludes ignored runtime files", (t) => {
  const directory = temporaryDirectory(t);
  mkdirSync(join(directory, "scripts"));
  copyFileSync(
    join(repo, "scripts/check-json.mjs"),
    join(directory, "scripts/check-json.mjs"),
  );
  const init = spawnSync("git", ["init", "--quiet", directory], {
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(join(directory, ".gitignore"), "runtime.json\n");
  writeFileSync(join(directory, "runtime.json"), "invalid but ignored");
  writeFileSync(join(directory, "settings.json"), "{}");
  const validate = () =>
    spawnSync(process.execPath, [join(directory, "scripts/check-json.mjs")], {
      encoding: "utf8",
    });
  assert.equal(validate().status, 0);
  writeFileSync(join(directory, "settings.json"), "{broken");
  const failure = validate();
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /invalid settings.json/);
});
