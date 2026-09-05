import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { registerCopyAllCommand, textFromMessageContent } from "./command.ts";

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

test("textFromMessageContent ignores unsupported and malformed content", () => {
  for (const content of [
    null,
    12,
    {},
    [null, {}, { type: "text", text: 42 }],
  ]) {
    assert.equal(textFromMessageContent(content), "");
  }
  assert.equal(textFromMessageContent("plain text"), "plain text");
});

async function runCopyCommand(branch: unknown[]) {
  let handler:
    | ((args: string, ctx: ExtensionCommandContext) => Promise<void>)
    | undefined;
  let copied: string | undefined;
  let notification = "";
  let idle = false;
  const pi = {
    registerCommand(name: string, options: { handler: typeof handler }) {
      assert.equal(name, "copy-all");
      handler = options.handler;
    },
  } as unknown as ExtensionAPI;
  registerCopyAllCommand(pi, async (text) => {
    copied = text;
  });

  const ctx = {
    async waitForIdle() {
      idle = true;
    },
    sessionManager: {
      getBranch() {
        assert.equal(idle, true, "wait for idle before reading the branch");
        return branch;
      },
      getEntries() {
        assert.fail("must not read inactive conversation branches");
      },
    },
    ui: {
      notify(message: string) {
        notification = message;
      },
    },
  } as unknown as ExtensionCommandContext;
  assert.ok(handler, "command handler was registered");
  await handler("", ctx);
  return { copied, notification };
}

test("copy-all copies only visible user/assistant text from the active branch", async () => {
  const result = await runCopyCommand([
    { type: "custom", customType: "metadata", data: "private" },
    { type: "message", message: { role: "user", content: " hello " } },
    {
      type: "message",
      message: { role: "toolResult", content: "secret tool output" },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "toolCall", name: "read" },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: " answer " }],
      },
    },
  ]);
  assert.equal(result.copied, "USER:\nhello\n\n---\n\nASSISTANT:\nanswer");
  assert.equal(result.notification, "Copied 2 messages");
});

test("copy-all leaves the clipboard untouched for empty conversations", async () => {
  for (const branch of [
    [],
    [
      { type: "message", message: { role: "user", content: "  " } },
      {
        type: "message",
        message: { role: "toolResult", content: "not conversation text" },
      },
    ],
  ]) {
    const result = await runCopyCommand(branch);
    assert.equal(result.copied, undefined);
    assert.equal(result.notification, "No user or assistant messages to copy");
  }
});
