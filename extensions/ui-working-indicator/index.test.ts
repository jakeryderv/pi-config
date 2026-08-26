import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import workingIndicatorExtension from "./index.ts";

function createHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const pi = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  workingIndicatorExtension(pi);
  return handlers;
}

test("working indicator installs and restores its labels and animation", async () => {
  const handlers = createHarness();
  const messages: Array<string | undefined> = [];
  const labels: Array<string | undefined> = [];
  const indicators: unknown[] = [];
  const ctx = {
    mode: "tui",
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setWorkingMessage: (message?: string) => messages.push(message),
      setHiddenThinkingLabel: (label?: string) => labels.push(label),
      setWorkingIndicator: (indicator?: unknown) => indicators.push(indicator),
    },
  } as unknown as ExtensionContext;

  await handlers.get("session_start")?.({}, ctx);
  await handlers.get("session_shutdown")?.({}, ctx);

  assert.deepEqual(messages, ["Working", undefined]);
  assert.deepEqual(labels, ["Reasoning…", undefined]);
  assert.deepEqual(indicators, [
    { frames: ["·", "•", "●", "•"], intervalMs: 160 },
    undefined,
  ]);
});
