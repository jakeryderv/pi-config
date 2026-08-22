import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { branchContainsLeaf } from "./lib/session-branch.ts";

const MAX_RUNNING = 8;
const MAX_OUTPUT_CHARS = 64 * 1024;
const TOOL_OUTPUT_CHARS = 16 * 1024;
const WIDGET_KEY = "background-terminals";

type TerminalStatus = "running" | "exited" | "failed" | "killed";

const OSC_PATTERN = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g;

export function sanitizeOutput(value: string) {
  return value
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(CONTROL_PATTERN, "");
}

interface BackgroundTerminal {
  id: string;
  title: string;
  command: string;
  cwd: string;
  originLeafId: string | null;
  child: ChildProcess;
  startedAt: number;
  endedAt?: number;
  status: TerminalStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  announced: boolean;
  closePromise: Promise<void>;
  resolveClose: () => void;
}

export function appendBounded(
  current: string,
  chunk: string,
  limit = MAX_OUTPUT_CHARS,
) {
  const combined = current + chunk;
  if (combined.length <= limit) return combined;
  const marker = "[earlier output truncated]\n";
  if (limit <= marker.length) return combined.slice(-limit);
  return `${marker}${combined.slice(-(limit - marker.length))}`;
}

function elapsed(terminal: BackgroundTerminal) {
  const end = terminal.endedAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - terminal.startedAt) / 1000));
  return `${seconds}s`;
}

function describe(terminal: BackgroundTerminal) {
  const result =
    terminal.status === "running"
      ? `pid ${terminal.child.pid ?? "?"}`
      : terminal.signal
        ? `signal ${terminal.signal}`
        : `exit ${terminal.exitCode ?? "?"}`;
  return `${terminal.id} [${terminal.status}] ${terminal.title} · ${result} · ${elapsed(terminal)}`;
}

function combinedOutput(terminal: BackgroundTerminal) {
  const parts: string[] = [];
  if (terminal.stdout.trim())
    parts.push(`STDOUT\n${terminal.stdout.trimEnd()}`);
  if (terminal.stderr.trim())
    parts.push(`STDERR\n${terminal.stderr.trimEnd()}`);
  return parts.join("\n\n") || "(no output)";
}

function toolReport(terminal: BackgroundTerminal) {
  const output = combinedOutput(terminal);
  const visible =
    output.length > TOOL_OUTPUT_CHARS
      ? `[output truncated to final ${TOOL_OUTPUT_CHARS} characters]\n${output.slice(-TOOL_OUTPUT_CHARS)}`
      : output;
  return `${describe(terminal)}\ncommand: ${sanitizeOutput(terminal.command)}\ncwd: ${sanitizeOutput(terminal.cwd)}\n\n${visible}`;
}

function signalProcessTree(
  terminal: BackgroundTerminal,
  signal: NodeJS.Signals,
) {
  const pid = terminal.child.pid;
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      terminal.child.kill(signal);
    } catch {
      // It may have exited between the status check and signal delivery.
    }
  }
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
          `${theme.fg("warning", "■")} ${count} background terminal${count === 1 ? "" : "s"} running ${theme.fg("dim", "·")} ${theme.fg("accent", "/ps")}`,
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
      console.error("background-terminals: could not deliver result", error);
    }
  };

  const start = (
    command: string,
    title: string,
    cwd: string,
    originLeafId: string | null,
  ) => {
    if (running().length >= MAX_RUNNING) {
      throw new Error(
        `At most ${MAX_RUNNING} background terminals may run at once.`,
      );
    }

    let resolveClose = () => {};
    const closePromise = new Promise<void>((resolvePromise) => {
      resolveClose = resolvePromise;
    });
    const child = spawn(process.env.SHELL ?? "/bin/bash", ["-lc", command], {
      cwd,
      detached: process.platform !== "win32",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const terminal: BackgroundTerminal = {
      id: `bg-${nextId++}`,
      title,
      command,
      cwd,
      originLeafId,
      child,
      startedAt: Date.now(),
      status: "running",
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      announced: false,
      closePromise,
      resolveClose,
    };
    terminals.set(terminal.id, terminal);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      terminal.stdout = appendBounded(
        terminal.stdout,
        sanitizeOutput(String(chunk)),
      );
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      terminal.stderr = appendBounded(
        terminal.stderr,
        sanitizeOutput(String(chunk)),
      );
    });
    child.on("error", (error) => {
      terminal.stderr = appendBounded(terminal.stderr, `${error.message}\n`);
      terminal.status = "failed";
    });
    child.on("close", (code, signal) => {
      terminal.endedAt = Date.now();
      terminal.exitCode = code;
      terminal.signal = signal;
      terminal.status = signal
        ? "killed"
        : terminal.status === "failed"
          ? "failed"
          : "exited";
      terminal.resolveClose();
      updateWidget();
      announceSettlement(terminal);
    });

    updateWidget();
    return terminal;
  };

  const stop = async (terminal: BackgroundTerminal) => {
    if (terminal.status !== "running") return;
    signalProcessTree(terminal, "SIGTERM");
    const killTimer = setTimeout(() => {
      if (terminal.status === "running") signalProcessTree(terminal, "SIGKILL");
    }, 2_000);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        terminal.closePromise,
        new Promise<void>((resolvePromise) => {
          deadline = setTimeout(resolvePromise, 4_000);
        }),
      ]);
    } finally {
      clearTimeout(killTimer);
      if (deadline) clearTimeout(deadline);
    }
  };

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
      const terminal = start(
        command,
        title,
        cwd,
        ctx.sessionManager.getLeafId(),
      );
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
      const selected = await ctx.ui.select("Background terminals", labels);
      if (!selected) return;
      const terminal = list[labels.indexOf(selected)];
      if (!terminal) return;
      await ctx.ui.custom((_tui, theme, _keybindings, done) => {
        const view = new Text(
          `${theme.fg("accent", theme.bold(describe(terminal)))}\n${theme.fg("dim", `${sanitizeOutput(terminal.cwd)}\n${sanitizeOutput(terminal.command)}`)}\n\n${combinedOutput(terminal)}\n\n${theme.fg("dim", "Enter or Esc to close")}`,
          1,
          0,
        );
        return {
          render: (width: number) => view.render(width),
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
