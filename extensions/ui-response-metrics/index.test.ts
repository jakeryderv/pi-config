import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import responseMetricsExtension, {
  formatPassDuration,
  formatPassTokens,
  type ResponsePassSummary,
} from "./index.ts";

function createHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  let entryRenderer:
    | ((
        entry: { data: ResponsePassSummary },
        options: { expanded: boolean },
        theme: { fg: (color: string, text: string) => string },
      ) => Component | undefined)
    | undefined;
  const pi = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      handlers.set(event, handler);
    },
    registerEntryRenderer(_customType: string, renderer: typeof entryRenderer) {
      entryRenderer = renderer;
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;
  responseMetricsExtension(pi);
  return { handlers, entries, getEntryRenderer: () => entryRenderer };
}

test("response metrics report current-response output and generation speed", async (t) => {
  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  const { handlers, entries, getEntryRenderer } = createHarness();
  await handlers.get("input")?.(
    { source: "interactive", streamingBehavior: undefined },
    {},
  );
  await handlers.get("before_agent_start")?.({}, {});
  await handlers.get("message_start")?.({ message: { role: "assistant" } }, {});
  now = 2_000;
  await handlers.get("message_end")?.(
    {
      message: {
        role: "assistant",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 200,
          cacheWrite: 25,
          totalTokens: 375,
        },
      },
    },
    {},
  );
  await handlers.get("turn_end")?.(
    {
      message: {
        role: "assistant",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 200,
          cacheWrite: 25,
          totalTokens: 375,
        },
        stopReason: "toolUse",
      },
      toolResults: [
        {
          usage: {
            input: 4,
            output: 6,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 10,
          },
        },
      ],
    },
    {},
  );
  await handlers.get("message_start")?.({ message: { role: "assistant" } }, {});
  now = 2_500;
  await handlers.get("message_end")?.(
    {
      message: {
        role: "assistant",
        usage: {
          input: 40,
          output: 25,
          cacheRead: 10,
          cacheWrite: 0,
          totalTokens: 75,
        },
      },
    },
    {},
  );
  await handlers.get("turn_end")?.(
    {
      message: {
        role: "assistant",
        usage: {
          input: 40,
          output: 25,
          cacheRead: 10,
          cacheWrite: 0,
          totalTokens: 75,
        },
        stopReason: "stop",
      },
      toolResults: [],
    },
    {},
  );
  now = 3_000;
  await handlers.get("agent_settled")?.({}, {});

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.customType, "response-pass-summary");
  const summary = entries[0]?.data as ResponsePassSummary;
  assert.deepEqual(
    {
      input: summary.input,
      output: summary.output,
      cacheRead: summary.cacheRead,
      cacheWrite: summary.cacheWrite,
      totalTokens: summary.totalTokens,
      modelCalls: summary.modelCalls,
      stopReason: summary.stopReason,
      durationMs: summary.durationMs,
      tokensPerSecond: summary.tokensPerSecond,
    },
    {
      input: 140,
      output: 75,
      cacheRead: 210,
      cacheWrite: 25,
      totalTokens: 450,
      modelCalls: 2,
      stopReason: "stop",
      durationMs: 2_000,
      tokensPerSecond: 50,
    },
  );

  const rendered = getEntryRenderer()?.(
    { data: summary },
    { expanded: false },
    { fg: (_color, text) => text },
  );
  assert.match(rendered?.render(100).join("\n") ?? "", /75 tokens · 50 tok\/s/);
});

test("response metrics format compact durations and token counts", () => {
  assert.equal(formatPassDuration(8_250), "8.3s");
  assert.equal(formatPassDuration(72_000), "1m 12s");
  assert.equal(formatPassTokens(8_250), "8.3k");
  assert.equal(formatPassTokens(1_250_000), "1.3m");
});
