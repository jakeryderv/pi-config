import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Key,
  matchesKey,
  SelectList,
  stripTerminalSequences,
  Text,
} from "@earendil-works/pi-tui";
import {
  renderStandardToolCall,
  renderStandardToolResult,
} from "../shared/tool-render.ts";
import { frameSurface } from "../shared/ui.ts";
import {
  collectToolRecords,
  type LiveToolRecord,
  toolArgumentSummary,
  toolRecordMetadata,
  toolRecordSections,
  toolRecordStatus,
  type ToolRecord,
} from "./records.ts";

const BUILT_IN_LABELS: Readonly<Record<string, string>> = {
  bash: "Run command",
  edit: "Edit file",
  find: "Find files",
  grep: "Search files",
  ls: "List directory",
  read: "Read file",
  write: "Write file",
};

const INSPECTOR_OVERLAY = {
  overlay: true,
  overlayOptions: {
    anchor: "center" as const,
    width: 76,
    minWidth: 48,
    maxHeight: "80%" as const,
    margin: 1,
  },
};

function builtInResultSummary(name: string, result: { details?: unknown }) {
  if (name === "write") return "Written";
  if (name !== "edit" || !result.details || typeof result.details !== "object")
    return undefined;
  const diff = (result.details as { diff?: unknown }).diff;
  if (typeof diff !== "string") return "Applied";

  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) removals++;
  }
  return `+${additions} / -${removals}`;
}

function registerCompactBuiltIns(pi: ExtensionAPI) {
  const cwd = process.cwd();
  const register = <TParams extends TSchema, TDetails, TState>(
    definition: ToolDefinition<TParams, TDetails, TState>,
  ) => {
    const label = BUILT_IN_LABELS[definition.name] ?? definition.label;
    pi.registerTool({
      ...definition,
      renderShell: "default",
      renderCall(args, theme, context) {
        return renderStandardToolCall({
          label,
          detail: toolArgumentSummary(args),
          theme,
          context,
        });
      },
      renderResult(result, options, theme, context) {
        return renderStandardToolResult({
          result,
          renderOptions: options,
          theme,
          context,
          summary: builtInResultSummary(definition.name, result),
        });
      },
    });
  };

  register(createReadToolDefinition(cwd));
  register(createBashToolDefinition(cwd));
  register(createEditToolDefinition(cwd));
  register(createWriteToolDefinition(cwd));
  register(createGrepToolDefinition(cwd));
  register(createFindToolDefinition(cwd));
  register(createLsToolDefinition(cwd));
}

function selectTheme(theme: Theme) {
  return {
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("text", text),
    description: (text: string) => theme.fg("dim", text),
    scrollInfo: (text: string) => theme.fg("dim", text),
    noMatch: (text: string) => theme.fg("muted", text),
  };
}

async function chooseTool(
  ctx: ExtensionContext,
  records: readonly ToolRecord[],
) {
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const items = records.map((record) => {
      const status = toolRecordStatus(record);
      const detail = toolArgumentSummary(record.args);
      return {
        value: record.id,
        label: `${theme.fg(status.color, status.icon)} ${record.name}${detail ? theme.fg("dim", ` · ${detail}`) : ""}`,
        description: toolRecordMetadata(record),
      };
    });
    const maxVisible = Math.max(
      3,
      Math.min(records.length, Math.floor(tui.terminal.rows * 0.7) - 4, 12),
    );
    const list = new SelectList(items, maxVisible, selectTheme(theme));
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);

    return {
      render: (width: number) => {
        const contentWidth = Math.max(1, width - 4);
        const selectedBackground = (text: string) =>
          stripTerminalSequences(text).trimStart().startsWith("→")
            ? theme.bg("selectedBg", text)
            : text;
        return frameSurface(list.render(contentWidth), width, {
          border: (text) => theme.fg("accent", text),
          title: theme.bold(theme.fg("accent", "Tool Inspector")),
          footer: theme.fg("dim", "↑↓ navigate · Enter inspect · Esc close"),
          paddingX: 1,
          sectionBackgrounds: [selectedBackground],
        });
      },
      invalidate: () => list.invalidate(),
      handleInput: (data: string) => list.handleInput(data),
    } satisfies Component;
  }, INSPECTOR_OVERLAY);
}

function detailText(record: ToolRecord, theme: Theme) {
  const status = toolRecordStatus(record);
  const lines = [
    `${theme.fg(status.color, status.icon)} ${theme.fg("muted", toolRecordMetadata(record))}`,
  ];

  for (const section of toolRecordSections(record)) {
    lines.push("", theme.bold(theme.fg("muted", section.title)));
    lines.push(
      ...section.text.split("\n").map((line) => theme.fg("toolOutput", line)),
    );
  }
  return lines.join("\n");
}

function showToolDetail(ctx: ExtensionContext, record: ToolRecord) {
  return ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const text = new Text(detailText(record, theme), 0, 0);
    let scrollTop = 0;
    let pageSize = 1;
    let maxScrollTop = 0;

    const scroll = (amount: number) => {
      scrollTop = Math.max(0, Math.min(maxScrollTop, scrollTop + amount));
      tui.requestRender();
    };

    return {
      render: (width: number) => {
        const contentWidth = Math.max(1, width - 4);
        const allLines = text.render(contentWidth);
        pageSize = Math.max(
          3,
          Math.min(
            allLines.length || 3,
            Math.floor(tui.terminal.rows * 0.72) - 3,
          ),
        );
        maxScrollTop = Math.max(0, allLines.length - pageSize);
        scrollTop = Math.min(scrollTop, maxScrollTop);
        const visible = allLines.slice(scrollTop, scrollTop + pageSize);
        const position =
          maxScrollTop > 0
            ? ` · ${scrollTop + 1}-${Math.min(allLines.length, scrollTop + pageSize)}/${allLines.length}`
            : "";
        return frameSurface(visible, width, {
          border: (value) => theme.fg("border", value),
          title: theme.bold(theme.fg("accent", record.name)),
          footer: theme.fg("dim", `↑↓/PgUp/PgDn scroll · Esc back${position}`),
          paddingX: 1,
        });
      },
      invalidate: () => {
        text.setText(detailText(record, theme));
        text.invalidate();
      },
      handleInput: (data: string) => {
        if (matchesKey(data, Key.escape)) {
          done(undefined);
        } else if (matchesKey(data, Key.up)) {
          scroll(-1);
        } else if (matchesKey(data, Key.down)) {
          scroll(1);
        } else if (matchesKey(data, Key.pageUp)) {
          scroll(-pageSize);
        } else if (matchesKey(data, Key.pageDown)) {
          scroll(pageSize);
        } else if (matchesKey(data, Key.home)) {
          scrollTop = 0;
          tui.requestRender();
        } else if (matchesKey(data, Key.end)) {
          scrollTop = maxScrollTop;
          tui.requestRender();
        }
      },
    } satisfies Component;
  }, INSPECTOR_OVERLAY);
}

function resultShape(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return value as {
    content?: LiveToolRecord["content"];
    details?: unknown;
  };
}

export default function toolInspectorExtension(pi: ExtensionAPI) {
  const liveRecords = new Map<string, LiveToolRecord>();
  let inspectorOpen = false;

  registerCompactBuiltIns(pi);

  pi.on("tool_execution_start", (event) => {
    liveRecords.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      args: event.args,
      startedAt: Date.now(),
    });
  });
  pi.on("tool_execution_update", (event) => {
    const record = liveRecords.get(event.toolCallId);
    if (!record) return;
    const partial = resultShape(event.partialResult);
    record.content = partial.content ?? record.content;
    record.details = partial.details ?? record.details;
  });
  pi.on("tool_execution_end", (event) => {
    const record = liveRecords.get(event.toolCallId) ?? {
      id: event.toolCallId,
      name: event.toolName,
      args: {},
      startedAt: Date.now(),
    };
    const result = resultShape(event.result);
    record.finishedAt = Date.now();
    record.content = result.content ?? [];
    record.details = result.details;
    record.isError = event.isError;
    liveRecords.set(event.toolCallId, record);
  });

  const inspect = async (ctx: ExtensionContext) => {
    if (inspectorOpen) return;
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Tool Inspector requires interactive mode", "error");
      return;
    }

    inspectorOpen = true;
    try {
      while (true) {
        const records = collectToolRecords(ctx.sessionManager.getBranch(), [
          ...liveRecords.values(),
        ]).reverse();
        if (records.length === 0) {
          ctx.ui.notify("No tool calls on the current branch", "info");
          return;
        }
        const selectedId = await chooseTool(ctx, records);
        if (!selectedId) return;
        const selected = records.find((record) => record.id === selectedId);
        if (selected) await showToolDetail(ctx, selected);
      }
    } finally {
      inspectorOpen = false;
    }
  };

  pi.registerCommand("tools", {
    description: "Inspect tool calls on the current branch",
    handler: async (_args, ctx) => inspect(ctx),
  });

  pi.on("session_start", (_event, ctx) => {
    liveRecords.clear();
    if (ctx.mode === "tui") ctx.ui.setToolsExpanded(false);
  });
  pi.on("session_tree", () => liveRecords.clear());
  pi.on("session_shutdown", () => {
    liveRecords.clear();
    inspectorOpen = false;
  });
}
