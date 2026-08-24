import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  renderStandardToolCall,
  renderStandardToolResult,
  toolContentMetadata,
} from "./tool-render.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("standard tool call uses a fixed two-line pending summary", () => {
  const component = renderStandardToolCall({
    label: "Background terminal",
    detail: "bg-1",
    theme,
    context: {
      executionStarted: true,
      isPartial: true,
      isError: false,
      state: { startedAt: Date.now() - 2_000 },
      lastComponent: undefined,
    },
  });

  const lines = component.render(80);
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /Background terminal · bg-1/);
  assert.match(lines[1] ?? "", /◐ Running · 2\.0s/);
});

test("standard tool result hides output and renders metadata only", () => {
  const output = "one\ntwo\nthree\nfour\nfive";
  const component = renderStandardToolResult({
    result: { content: [{ type: "text", text: output }] },
    renderOptions: { expanded: true, isPartial: false },
    theme,
    context: {
      executionStarted: true,
      isPartial: false,
      isError: false,
      state: { startedAt: Date.now() - 2_000 },
      lastComponent: undefined,
    },
  });

  const lines = component.render(80);
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /^✓ 2\.0s · 5 lines · 23 B$/);
  assert.doesNotMatch(lines.join("\n"), /one|five/);
});

test("compact tool rows truncate instead of wrapping", () => {
  const component = renderStandardToolCall({
    label: "Read file",
    detail: "a/very/long/path/that/would/normally/wrap.ts",
    theme,
    context: {
      executionStarted: false,
      isPartial: false,
      isError: false,
      state: {},
      lastComponent: undefined,
    },
  });

  assert.equal(component.render(20).length, 1);
  assert.equal(visibleWidth(component.render(20)[0] ?? ""), 20);
});

test("tool content metadata accounts for text and images", () => {
  assert.deepEqual(
    toolContentMetadata([{ type: "text", text: "hello" }, { type: "image" }]),
    ["1 line", "5 B", "1 image"],
  );
});
