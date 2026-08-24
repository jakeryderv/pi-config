import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import backgroundTerminalsExtension, {
  appendBounded,
  sanitizeOutput,
} from "./index.ts";

test("appendBounded retains the newest output within the limit", () => {
  const output = appendBounded("abcdefghij", "klmnopqrst", 16);
  assert.equal(output.length, 16);
  assert.equal(output, "efghijklmnopqrst");
});

test("sanitizeOutput strips terminal escape and control sequences", () => {
  assert.equal(
    sanitizeOutput("safe\u001b[31m red\u001b[0m\u0000\n"),
    "safe red\n",
  );
});

test("background terminal tools start a process and capture its output", async () => {
  interface TestToolResult {
    content: Array<{ type: string; text: string }>;
    details?: unknown;
  }
  interface TestTool {
    name: string;
    renderCall?: unknown;
    renderResult?: unknown;
    renderShell?: unknown;
    execute: (...args: unknown[]) => Promise<TestToolResult>;
  }

  type TestEventHandler = (event: unknown, ctx: ExtensionContext) => unknown;
  const tools = new Map<string, TestTool>();
  const eventHandlers = new Map<string, TestEventHandler[]>();
  let deliveries = 0;
  const fakePi = {
    registerTool(tool: TestTool) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    on(event: string, handler: TestEventHandler) {
      const registered = eventHandlers.get(event) ?? [];
      registered.push(handler);
      eventHandlers.set(event, registered);
    },
    sendMessage() {
      deliveries += 1;
    },
  } as unknown as ExtensionAPI;
  backgroundTerminalsExtension(fakePi);

  const start = tools.get("bg_start");
  const status = tools.get("bg_status");
  assert.ok(start && status);
  for (const tool of tools.values()) {
    assert.equal(tool.renderCall, undefined);
    assert.equal(tool.renderResult, undefined);
    assert.equal(tool.renderShell, undefined);
  }
  let leafId = "leaf-1";
  let branchIds: string[] = [];
  const context = {
    cwd: process.cwd(),
    hasUI: false,
    sessionManager: {
      getLeafId: () => leafId,
      getBranch: () => branchIds.map((id) => ({ id })),
    },
  } as unknown as ExtensionContext;
  for (const handler of eventHandlers.get("session_start") ?? []) {
    await handler({ type: "session_start" }, context);
  }
  const started = await start.execute(
    "test-start",
    { command: "sleep 0.05; printf 'captured output'", title: "test" },
    undefined,
    undefined,
    context,
  );
  const id = (started.details as { id: string }).id;
  leafId = "leaf-2";

  let report = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    const result = await status.execute("test-status", { id });
    report = result.content[0]?.text ?? "";
    if (report.includes("[exited]")) break;
  }

  assert.match(report, /\[exited\]/);
  assert.match(report, /captured output/);
  assert.equal(deliveries, 0, "result must not attach after branch navigation");

  // Normal continuation advances the leaf but retains the origin as an ancestor.
  const continued = await start.execute(
    "test-continued",
    { command: "sleep 0.05", title: "continued" },
    undefined,
    undefined,
    context,
  );
  const continuedId = (continued.details as { id: string }).id;
  branchIds = [leafId];
  leafId = "leaf-3";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    const result = await status.execute("test-continued-status", {
      id: continuedId,
    });
    if ((result.content[0]?.text ?? "").includes("[exited]")) break;
  }
  assert.equal(deliveries, 1, "result should attach to a descendant branch");

  for (const handler of eventHandlers.get("session_shutdown") ?? []) {
    await handler({ type: "session_shutdown" }, context);
  }
});
