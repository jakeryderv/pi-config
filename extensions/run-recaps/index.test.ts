import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import automaticRunRecapsExtension, {
  localFallback,
  serializeRun,
} from "./index.ts";

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
