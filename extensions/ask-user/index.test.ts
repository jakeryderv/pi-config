import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import askUserExtension from "./index.ts";

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
