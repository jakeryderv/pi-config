import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import systemPromptInspectorExtension from "./index.ts";

test("system prompt inspector uses Pi's native editor dialog", async () => {
  let handler:
    | ((args: string, ctx: ExtensionCommandContext) => Promise<void>)
    | undefined;
  const pi = {
    registerCommand(
      _name: string,
      options: {
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      },
    ) {
      handler = options.handler;
    },
  } as unknown as ExtensionAPI;
  systemPromptInspectorExtension(pi);

  let title = "";
  let contents = "";
  const ctx = {
    getSystemPrompt: () => "effective prompt",
    ui: {
      async editor(nextTitle: string, nextContents: string) {
        title = nextTitle;
        contents = nextContents;
        return nextContents;
      },
    },
  } as unknown as ExtensionCommandContext;

  await handler?.("", ctx);

  assert.match(title, /^System prompt · \d+ chars$/);
  assert.equal(contents, "effective prompt");
});
