import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import askUserExtension from "../ask-user.ts";
import backgroundTerminalsExtension, {
  appendBounded,
  sanitizeOutput,
} from "../background-terminals.ts";
import { textFromMessageContent } from "../copy-all.ts";
import automaticRunRecapsExtension, {
  localFallback,
  serializeRun,
} from "../run-recaps.ts";

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

test("ask_user rejects ambiguous option labels", async () => {
  let askTool:
    | { execute: (...args: unknown[]) => Promise<unknown> }
    | undefined;
  const fakePi = {
    registerTool(tool: { execute: (...args: unknown[]) => Promise<unknown> }) {
      askTool = tool;
    },
  } as unknown as ExtensionAPI;
  askUserExtension(fakePi);
  assert.ok(askTool);
  const context = { mode: "print" } as ExtensionContext;

  await assert.rejects(
    askTool.execute(
      "test",
      {
        question: "Choose",
        options: [{ label: "Same" }, { label: "Same" }],
      },
      undefined,
      undefined,
      context,
    ),
    /must be unique/,
  );
  await assert.rejects(
    askTool.execute(
      "test",
      {
        question: "Choose",
        options: [{ label: "Write my own answer…" }, { label: "Other" }],
      },
      undefined,
      undefined,
      context,
    ),
    /custom-answer label/,
  );
});

test("textFromMessageContent keeps text and image placeholders", () => {
  assert.equal(
    textFromMessageContent([
      { type: "text", text: "hello" },
      { type: "toolCall", name: "read" },
      { type: "image" },
    ]),
    "hello\n[image]",
  );
});

test("serializeRun captures messages, tool calls, and tool results", () => {
  const entries = [
    {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "Fix it" }],
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Inspecting." },
          { type: "toolCall", name: "read", arguments: { path: "a.ts" } },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "read",
        content: [{ type: "text", text: "const value = 1;" }],
      },
    },
  ] as unknown as Parameters<typeof serializeRun>[0];

  const transcript = serializeRun(entries);
  assert.match(transcript, /USER:\nFix it/);
  assert.match(transcript, /TOOL CALL read \(arguments omitted\)/);
  assert.match(transcript, /TOOL RESULT read: completed \(output omitted\)/);
  assert.doesNotMatch(transcript, /a\.ts|const value/);
});

test("automatic recaps honor run and branch boundaries", async () => {
  type TestHandler = (event: unknown, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, TestHandler[]>();
  const recaps: unknown[] = [];
  const prompts: string[] = [];
  let pendingResolve: ((value: unknown) => void) | undefined;
  let deferCompletion = false;

  const activeModel = { provider: "anthropic", id: "test-model" };
  const fakePi = {
    registerEntryRenderer() {},
    registerCommand() {},
    on(event: string, handler: TestHandler) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    appendEntry(_type: string, data: unknown) {
      recaps.push(data);
    },
  } as unknown as ExtensionAPI;
  automaticRunRecapsExtension(fakePi);

  const branch: unknown[] = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "previous run" }],
      },
    },
  ];
  let leafId = "leaf-a";
  const context = {
    mode: "tui",
    hasUI: true,
    model: activeModel,
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus() {},
      notify() {},
    },
    sessionManager: {
      getBranch: () => branch,
      getLeafId: () => leafId,
    },
    modelRegistry: {
      hasConfiguredAuth: () => true,
      find: () => undefined,
      complete: (
        model: { provider: string },
        request: { messages: Array<{ content: Array<{ text: string }> }> },
      ) => {
        assert.equal(model.provider, "anthropic");
        prompts.push(request.messages[0]?.content[0]?.text ?? "");
        if (deferCompletion) {
          return new Promise((resolvePromise) => {
            pendingResolve = resolvePromise;
          });
        }
        return Promise.resolve({
          content: [{ type: "text", text: "### Outcome\nRecapped" }],
        });
      },
    },
  } as unknown as ExtensionContext;
  const emit = async (event: string) => {
    for (const handler of handlers.get(event) ?? []) {
      await handler({ type: event }, context);
    }
  };
  const waitForRecaps = async (count: number) => {
    for (let attempt = 0; attempt < 40 && recaps.length < count; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    }
  };

  await emit("session_start");
  await emit("before_agent_start");
  await emit("agent_start");
  branch.push(
    {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "current run" }],
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "current answer" }],
      },
    },
  );
  await emit("agent_settled");
  await waitForRecaps(1);
  assert.equal(recaps.length, 1);
  assert.match(prompts[0] ?? "", /current run/);
  assert.doesNotMatch(prompts[0] ?? "", /previous run/);

  // Extension-triggered runs emit agent_start without before_agent_start.
  await emit("agent_start");
  branch.push(
    { type: "custom", customType: "follow-up", data: {} },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "follow-up answer" }],
      },
    },
  );
  await emit("agent_settled");
  await waitForRecaps(2);
  assert.equal(recaps.length, 2);
  assert.match(prompts[1] ?? "", /follow-up answer/);

  // A recap finishing after tree navigation must not attach to the new leaf.
  deferCompletion = true;
  await emit("agent_start");
  branch.push({
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "branch answer" }],
    },
  });
  await emit("agent_settled");
  await emit("session_before_tree");
  leafId = "leaf-b";
  pendingResolve?.({ content: [{ type: "text", text: "late recap" }] });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  assert.equal(recaps.length, 2);
  await emit("session_shutdown");
});

test("localFallback uses the final assistant text", () => {
  const entries = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Implemented and verified." }],
      },
    },
  ] as unknown as Parameters<typeof localFallback>[0];

  assert.match(localFallback(entries), /Implemented and verified\./);
});
