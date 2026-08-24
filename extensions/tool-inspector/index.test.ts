import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import toolInspectorExtension from "./index.ts";

test("tool inspector installs compact built-in renderers and /tools", () => {
  const tools: ToolDefinition[] = [];
  const shortcuts: string[] = [];
  const commands: string[] = [];
  const pi = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    registerShortcut: (shortcut: string) => shortcuts.push(shortcut),
    registerCommand: (command: string) => commands.push(command),
    on: () => {},
  } as unknown as ExtensionAPI;

  toolInspectorExtension(pi);

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["read", "bash", "edit", "write", "grep", "find", "ls"],
  );
  assert.ok(tools.every((tool) => tool.renderShell === "default"));
  assert.ok(tools.every((tool) => tool.renderCall && tool.renderResult));
  assert.deepEqual(shortcuts, []);
  assert.deepEqual(commands, ["tools"]);
});
