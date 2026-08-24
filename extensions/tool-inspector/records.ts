import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  formatToolDuration,
  toolContentMetadata,
} from "../shared/tool-render.ts";

export interface ToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface LiveToolRecord {
  id: string;
  name: string;
  args: unknown;
  startedAt: number;
  finishedAt?: number;
  content?: ToolContent[];
  details?: unknown;
  isError?: boolean;
}

export interface ToolRecord {
  id: string;
  name: string;
  args: unknown;
  startedAt?: number;
  finishedAt?: number;
  content: ToolContent[];
  details?: unknown;
  usage?: unknown;
  isError?: boolean;
}

interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
}

function timestamp(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isToolCall(value: unknown): value is ToolCallBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as Partial<ToolCallBlock>;
  return (
    block.type === "toolCall" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  );
}

export function collectToolRecords(
  entries: readonly SessionEntry[],
  liveRecords: readonly LiveToolRecord[] = [],
) {
  const records = new Map<string, ToolRecord>();
  const order: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;

    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isToolCall(block)) continue;
        records.set(block.id, {
          id: block.id,
          name: block.name,
          args: block.arguments,
          startedAt: timestamp(message.timestamp) ?? timestamp(entry.timestamp),
          content: [],
        });
        order.push(block.id);
      }
      continue;
    }

    if (message.role !== "toolResult") continue;
    const existing = records.get(message.toolCallId);
    const record = existing ?? {
      id: message.toolCallId,
      name: message.toolName,
      args: {},
      content: [],
    };
    record.name = message.toolName;
    record.content = [...message.content];
    record.details = message.details;
    record.usage = message.usage;
    record.isError = message.isError;
    record.finishedAt =
      timestamp(message.timestamp) ?? timestamp(entry.timestamp);
    records.set(record.id, record);
    if (!existing) order.push(record.id);
  }

  for (const live of liveRecords) {
    const existing = records.get(live.id);
    const record: ToolRecord = {
      id: live.id,
      name: live.name,
      args: live.args,
      startedAt: live.startedAt,
      finishedAt: live.finishedAt,
      content: live.content ?? existing?.content ?? [],
      details: live.details ?? existing?.details,
      usage: existing?.usage,
      isError: live.isError ?? existing?.isError,
    };
    records.set(live.id, record);
    if (!existing) order.push(live.id);
  }

  return order.flatMap((id) => {
    const record = records.get(id);
    return record ? [record] : [];
  });
}

function compactValue(value: unknown) {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

export function toolArgumentSummary(args: unknown) {
  if (!args || typeof args !== "object") return "";
  const input = args as Record<string, unknown>;
  const keys = [
    "path",
    "query",
    "pattern",
    "command",
    "title",
    "url",
    "id",
    "question",
    "action",
  ];
  const values = keys.flatMap((key) => {
    const value = compactValue(input[key]);
    return value ? [value] : [];
  });
  return values.slice(0, 2).join(" · ");
}

export function toolRecordMetadata(record: ToolRecord) {
  const parts: string[] = [];
  if (record.startedAt !== undefined && record.finishedAt !== undefined) {
    parts.push(formatToolDuration(record.finishedAt - record.startedAt));
  } else if (record.finishedAt === undefined) {
    parts.push("running");
  }
  parts.push(...toolContentMetadata(record.content));
  return parts.length > 0 ? parts.join(" · ") : "no output";
}

export function toolRecordStatus(record: ToolRecord) {
  if (record.finishedAt === undefined)
    return { icon: "◐", color: "dim" } as const;
  if (record.isError) return { icon: "×", color: "error" } as const;
  return { icon: "✓", color: "success" } as const;
}

function printable(value: unknown) {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function outputText(content: readonly ToolContent[]) {
  return content
    .map((item) => {
      if (item.type === "text") return item.text ?? "";
      if (item.type === "image")
        return `[${item.mimeType ?? "image"} image data]`;
      return `[${item.type} content]`;
    })
    .join("\n");
}

export function toolRecordSections(record: ToolRecord) {
  const sections: Array<{ title: string; text: string }> = [
    { title: "Arguments", text: printable(record.args) || "{}" },
    { title: "Output", text: outputText(record.content) || "No output" },
  ];
  if (record.details !== undefined) {
    sections.push({ title: "Details", text: printable(record.details) });
  }
  if (record.usage !== undefined) {
    sections.push({ title: "Usage", text: printable(record.usage) });
  }
  return sections.map((section) => ({
    ...section,
    text: stripTerminalSequences(section.text),
  }));
}
