import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  collectToolRecords,
  toolArgumentSummary,
  toolRecordMetadata,
  toolRecordSections,
} from "./records.ts";

const entries = [
  {
    type: "message",
    id: "assistant",
    parentId: null,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "read",
          arguments: { path: "src/index.ts", offset: 4 },
        },
      ],
      timestamp: 1_000,
    },
  },
  {
    type: "message",
    id: "result",
    parentId: "assistant",
    timestamp: "2026-01-01T00:00:01.250Z",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "first\nsecond" }],
      details: { truncation: { truncated: false } },
      isError: false,
      timestamp: 1_250,
    },
  },
] as SessionEntry[];

test("collectToolRecords pairs calls and results without changing full output", () => {
  const [record] = collectToolRecords(entries);

  assert.equal(record?.name, "read");
  assert.deepEqual(record?.args, { path: "src/index.ts", offset: 4 });
  assert.equal(record?.content[0]?.text, "first\nsecond");
  assert.equal(record?.finishedAt, 1_250);
  assert.equal(toolRecordMetadata(record!), "250ms · 2 lines · 12 B");
});

test("live records override persisted timing and status", () => {
  const [record] = collectToolRecords(entries, [
    {
      id: "call-1",
      name: "read",
      args: { path: "src/index.ts" },
      startedAt: 2_000,
      finishedAt: 2_125,
      content: [{ type: "text", text: "updated" }],
      isError: true,
    },
  ]);

  assert.equal(record?.startedAt, 2_000);
  assert.equal(record?.finishedAt, 2_125);
  assert.equal(record?.isError, true);
  assert.equal(record?.content[0]?.text, "updated");
});

test("tool summaries stay one line and detail sections retain full data", () => {
  assert.equal(
    toolArgumentSummary({ command: "npm   test\n-- --run", title: "Tests" }),
    "npm test -- --run · Tests",
  );

  const [record] = collectToolRecords(entries);
  const sections = toolRecordSections(record!);
  assert.match(
    sections.find((section) => section.title === "Arguments")?.text ?? "",
    /src\/index\.ts/,
  );
  assert.equal(
    sections.find((section) => section.title === "Output")?.text,
    "first\nsecond",
  );
});
