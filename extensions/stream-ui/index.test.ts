import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Markdown,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import {
  colorizeAssistantHeadings,
  finalizeAssistantMarkdown,
  formatPassDuration,
  formatPassTokens,
  normalizeCodeFenceLanguages,
  type ResponsePassSummary,
  default as streamUiExtension,
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
    registerMarkdownTransformer() {},
    registerEntryRenderer(_customType: string, renderer: typeof entryRenderer) {
      entryRenderer = renderer;
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;
  streamUiExtension(pi);
  return { handlers, entries, getEntryRenderer: () => entryRenderer };
}

test("stream UI installs and restores the restrained working indicator", async () => {
  const { handlers } = createHarness();
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

test("stream UI reports current-response output tokens and generation speed", async (t) => {
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

test("pass summary formats compact durations and token counts", () => {
  assert.equal(formatPassDuration(8_250), "8.3s");
  assert.equal(formatPassDuration(72_000), "1m 12s");
  assert.equal(formatPassTokens(8_250), "8.3k");
  assert.equal(formatPassTokens(1_250_000), "1.3m");
});

test("assistant prose stays hidden until its message is finalized", () => {
  const streaming = { messageType: "assistant", isStreaming: true };
  const finalized = { messageType: "assistant", isStreaming: false };
  assert.equal(finalizeAssistantMarkdown("response", streaming), "");
  assert.equal(finalizeAssistantMarkdown("response", finalized), "response");
  assert.equal(
    finalizeAssistantMarkdown("user text", {
      messageType: "user",
      isStreaming: true,
    }),
    "user text",
  );
});

test("final assistant code fences use canonical language names", () => {
  const markdown = [
    "```ts",
    "const value = 42;",
    "```not-a-closing-fence",
    "### still code",
    "```",
    "~~~py",
    "print('ok')",
    "~~~",
  ].join("\n");

  assert.equal(
    normalizeCodeFenceLanguages(markdown),
    [
      "```typescript",
      "const value = 42;",
      "```not-a-closing-fence",
      "### still code",
      "```",
      "~~~python",
      "print('ok')",
      "~~~",
    ].join("\n"),
  );
});

test("final assistant headings receive distinct colors without H3+ hashes", () => {
  const markdown = [
    "# One",
    "## Two",
    "### Three",
    "#### Four",
    "##### Five",
    "###### Six",
    "```md",
    "# Literal",
    "```",
  ].join("\n");

  assert.equal(
    colorizeAssistantHeadings(markdown),
    [
      "# \u001b[38;2;255;126;182mOne\u001b[39m",
      "## \u001b[38;2;190;149;255mTwo\u001b[39m",
      "## \u001b[38;2;120;169;255mThree\u001b[39m",
      "## \u001b[38;2;51;177;255mFour\u001b[39m",
      "## \u001b[38;2;61;219;217mFive\u001b[39m",
      "## \u001b[38;2;182;184;187mSix\u001b[39m",
      "```md",
      "# Literal",
      "```",
    ].join("\n"),
  );
});

test("Pi's Markdown renderer preserves finalized heading colors", () => {
  const identity = (text: string) => text;
  const theme: MarkdownTheme = {
    heading: identity,
    link: identity,
    linkUrl: identity,
    code: identity,
    codeBlock: identity,
    codeBlockBorder: identity,
    quote: identity,
    quoteBorder: identity,
    hr: identity,
    listBullet: identity,
    bold: identity,
    italic: identity,
    strikethrough: identity,
    underline: identity,
  };
  const rendered = new Markdown(
    colorizeAssistantHeadings("# One\n## Two\n### Three"),
    0,
    0,
    theme,
  )
    .render(80)
    .join("\n");

  assert.match(rendered, /\u001b\[38;2;255;126;182mOne\u001b\[39m/);
  assert.match(rendered, /\u001b\[38;2;190;149;255mTwo\u001b\[39m/);
  assert.match(rendered, /\u001b\[38;2;120;169;255mThree\u001b\[39m/);
  assert.doesNotMatch(rendered, /###/);
});
