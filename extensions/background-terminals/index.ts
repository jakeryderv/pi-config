import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { branchContainsLeaf } from "../shared/session-branch.ts";
import {
  renderStandardToolCall,
  renderStandardToolResult,
} from "../shared/tool-render.ts";
import { frameSurface, selectSurface } from "../shared/ui.ts";
import type { BackgroundTerminal } from "./domain.ts";
import {
  combinedOutput,
  describe,
  sanitizeOutput,
  toolReport,
} from "./output.ts";
import { startTerminal, stopTerminal } from "./process.ts";

export { appendBounded, sanitizeOutput } from "./output.ts";

const MAX_RUNNING = 8;
const WIDGET_KEY = "background-terminals";

type StandardCallOptions = Parameters<typeof renderStandardToolCall>[0];
type StandardResultOptions = Parameters<typeof renderStandardToolResult>[0];

function renderTerminalCall(
  options: Omit<StandardCallOptions, "detail"> & { id: string },
) {
  return renderStandardToolCall({ ...options, detail: options.id });
}

function renderTerminalResult(
  options: Omit<StandardResultOptions, "collapsedLines">,
) {
  return renderStandardToolResult({ ...options, collapsedLines: 3 });
}

function terminalIdRenderers(label: string) {
  return {
    renderCall(
      args: { id: string },
      theme: StandardCallOptions["theme"],
      context: StandardCallOptions["context"],
    ) {
      return renderTerminalCall({ label, id: args.id, theme, context });
    },
    renderResult(
      ...args: [
        StandardResultOptions["result"],
        StandardResultOptions["renderOptions"],
        StandardResultOptions["theme"],
        StandardResultOptions["context"],
      ]
    ) {
      const [result, renderOptions, theme, context] = args;
      return renderTerminalResult({ result, renderOptions, theme, context });
    },
  };
}

export default function backgroundTerminalsExtension(pi: ExtensionAPI) {
  const terminals = new Map<string, BackgroundTerminal>();
  let nextId = 1;
  let sessionContext: ExtensionContext | undefined;
  let shuttingDown = false;

  const running = () =>
    [...terminals.values()].filter((terminal) => terminal.status === "running");

  const updateWidget = () => {
    const ctx = sessionContext;
    if (!ctx?.hasUI) return;
    const count = running().length;
    if (count === 0) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(
      WIDGET_KEY,
      (_tui, theme) =>
        new Text(
          `${theme.fg("accent", "●")} ${count} background terminal${count === 1 ? "" : "s"} running ${theme.fg("dim", "·")} ${theme.fg("accent", "/ps")}`,
          0,
          0,
        ),
    );
  };

  const announceSettlement = (terminal: BackgroundTerminal) => {
    if (
      shuttingDown ||
      terminal.announced ||
      !sessionContext ||
      !branchContainsLeaf(sessionContext, terminal.originLeafId)
    ) {
      return;
    }
    terminal.announced = true;
    try {
      pi.sendMessage(
        {
          customType: "background-terminal-result",
          content: `Background terminal settled.\n${toolReport(terminal)}`,
          display: true,
          details: {
            id: terminal.id,
            title: terminal.title,
            status: terminal.status,
            exitCode: terminal.exitCode,
            signal: terminal.signal,
          },
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    } catch (error) {
      sessionContext?.ui.notify(
        `Could not deliver background-terminal result: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  };

  const start = (options: {
    command: string;
    title: string;
    cwd: string;
    originLeafId: string | null;
  }) => {
    if (running().length >= MAX_RUNNING) {
      throw new Error(
        `At most ${MAX_RUNNING} background terminals may run at once.`,
      );
    }

    const terminal = startTerminal({
      id: `bg-${nextId++}`,
      title: options.title,
      command: options.command,
      cwd: options.cwd,
      originLeafId: options.originLeafId,
      onChange: updateWidget,
      onSettlement: announceSettlement,
    });
    terminals.set(terminal.id, terminal);
    updateWidget();
    return terminal;
  };

  const stop = stopTerminal;

  const requireTerminal = (id: string) => {
    const terminal = terminals.get(id);
    if (!terminal) throw new Error(`Unknown background terminal: ${id}`);
    return terminal;
  };

  const terminalResult = (terminal: BackgroundTerminal) => ({
    content: [{ type: "text" as const, text: toolReport(terminal) }],
    details: { id: terminal.id, status: terminal.status },
  });

  pi.on("session_start", (_event, ctx) => {
    sessionContext = ctx;
    shuttingDown = false;
    updateWidget();
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    if (sessionContext?.hasUI) {
      sessionContext.ui.setWidget(WIDGET_KEY, undefined);
    }
    await Promise.all(running().map(stop));
    terminals.clear();
    sessionContext = undefined;
  });

  pi.registerTool({
    name: "bg_start",
    label: "Start Background Terminal",
    description:
      "Start a long-running shell command without blocking the agent. Returns an id for status and cancellation.",
    promptSnippet:
      "Start and monitor long-running shell commands in managed background terminals",
    promptGuidelines: [
      "Use bg_start for long-running servers, watchers, and commands that should continue while other work proceeds; use bash for short commands.",
      "After bg_start, use bg_status or bg_list when intermediate output is needed; completion is also delivered automatically.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      title: Type.String({ description: "Short human-readable title" }),
      working_dir: Type.Optional(
        Type.String({
          description:
            "Working directory; relative paths resolve from the project, while absolute and parent paths are allowed",
        }),
      ),
    }),
    renderShell: "self",
    renderCall(args, theme, context) {
      return renderStandardToolCall({
        label: "Start terminal",
        detail: args.title || args.command,
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
      });
    },
    async execute(_id, params, _signal, _update, ctx) {
      const command = params.command.trim();
      if (!command) throw new Error("command must not be empty");
      const cwd = resolve(ctx.cwd, params.working_dir ?? ".");
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        throw new Error(`working_dir is not a directory: ${cwd}`);
      }
      const title =
        sanitizeOutput(params.title).replace(/\s+/g, " ").trim().slice(0, 80) ||
        "terminal";
      const terminal = start({
        command,
        title,
        cwd,
        originLeafId: ctx.sessionManager.getLeafId(),
      });
      return {
        content: [
          {
            type: "text",
            text: `Started ${terminal.id} (${terminal.title}), pid ${terminal.child.pid ?? "?"}.`,
          },
        ],
        details: { id: terminal.id, pid: terminal.child.pid, title, cwd },
      };
    },
  });

  pi.registerTool({
    name: "bg_status",
    label: "Background Terminal Status",
    description:
      "Show status and recent output for one managed background terminal.",
    parameters: Type.Object({
      id: Type.String({ description: "Terminal id from bg_start" }),
    }),
    renderShell: "self",
    ...terminalIdRenderers("Terminal status"),
    async execute(_id, params) {
      const terminal = requireTerminal(params.id);
      if (terminal.status !== "running") terminal.announced = true;
      return terminalResult(terminal);
    },
  });

  pi.registerTool({
    name: "bg_list",
    label: "List Background Terminals",
    description: "List all managed background terminals in this session.",
    parameters: Type.Object({}),
    renderShell: "self",
    renderCall(_args, theme, context) {
      return renderStandardToolCall({
        label: "List terminals",
        theme,
        context,
      });
    },
    renderResult(result, options, theme, context) {
      return renderTerminalResult({
        result,
        renderOptions: options,
        theme,
        context,
      });
    },
    async execute() {
      const list = [...terminals.values()];
      return {
        content: [
          {
            type: "text",
            text: list.length
              ? list.map(describe).join("\n")
              : "No background terminals.",
          },
        ],
        details: { count: list.length },
      };
    },
  });

  pi.registerTool({
    name: "bg_kill",
    label: "Stop Background Terminal",
    description:
      "Stop one managed background terminal and return its final output.",
    parameters: Type.Object({
      id: Type.String({ description: "Terminal id from bg_start" }),
    }),
    renderShell: "self",
    ...terminalIdRenderers("Stop terminal"),
    async execute(_id, params) {
      const terminal = requireTerminal(params.id);
      terminal.announced = true;
      await stop(terminal);
      return terminalResult(terminal);
    },
  });

  pi.registerCommand("ps", {
    description: "Inspect managed background terminals",
    handler: async (_args, ctx) => {
      const list = [...terminals.values()];
      if (list.length === 0) {
        ctx.ui.notify("No background terminals", "info");
        return;
      }
      const labels = list.map(describe);
      const selected = await selectSurface(
        ctx.ui,
        "Background terminals",
        labels,
      );
      if (!selected) return;
      const terminal = list[labels.indexOf(selected)];
      if (!terminal) return;
      await ctx.ui.custom((_tui, theme, _keybindings, done) => {
        const view = new Text(
          `${theme.fg("dim", `${sanitizeOutput(terminal.cwd)}\n${sanitizeOutput(terminal.command)}`)}\n\n${combinedOutput(terminal)}`,
          0,
          0,
        );
        return {
          render: (width: number) =>
            frameSurface(view.render(Math.max(1, width - 4)), width, {
              border: (text) => theme.fg("border", text),
              title: theme.bold(theme.fg("accent", describe(terminal))),
              footer: theme.fg("dim", "Enter or Esc to close"),
              paddingX: 1,
            }),
          invalidate: () => view.invalidate(),
          handleInput: (data: string) => {
            if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape))
              done(undefined);
          },
        };
      });
    },
  });
}
