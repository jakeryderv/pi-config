import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { BackgroundTerminal } from "./domain.ts";
import { inspectBackgroundTerminals } from "./ui.ts";

function terminal(): BackgroundTerminal {
  return {
    id: "bg-1",
    title: "server",
    command: "npm run dev",
    cwd: "/repo",
    originLeafId: null,
    child: { pid: 123 } as BackgroundTerminal["child"],
    startedAt: Date.now(),
    status: "running",
    exitCode: null,
    signal: null,
    stdout: "ready\n",
    stderr: "",
    announced: false,
    closePromise: Promise.resolve(),
    resolveClose() {},
  };
}

test("terminal inspector uses Pi's native select and editor dialogs", async () => {
  const item = terminal();
  let selectTitle = "";
  let editorTitle = "";
  let editorText = "";
  const ctx = {
    ui: {
      async select(title: string, options: string[]) {
        selectTitle = title;
        return options[0];
      },
      async editor(title: string, text: string) {
        editorTitle = title;
        editorText = text;
        return text;
      },
      notify() {},
    },
  } as unknown as ExtensionCommandContext;

  await inspectBackgroundTerminals(ctx, [item]);

  assert.equal(selectTitle, "Background terminals");
  assert.match(editorTitle, /bg-1 \[running\] server/);
  assert.match(editorText, /cwd: \/repo/);
  assert.match(editorText, /command: npm run dev/);
  assert.match(editorText, /STDOUT\nready/);
});
