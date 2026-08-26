import { spawn } from "node:child_process";
import type { BackgroundTerminal } from "./domain.ts";
import { appendBounded, sanitizeOutput } from "./output.ts";

interface StartTerminalOptions {
  id: string;
  title: string;
  command: string;
  cwd: string;
  originLeafId: string | null;
  onSettlement: (terminal: BackgroundTerminal) => void;
}

export function startTerminal({
  id,
  title,
  command,
  cwd,
  originLeafId,
  onSettlement,
}: StartTerminalOptions): BackgroundTerminal {
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
    id,
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
    onSettlement(terminal);
  });

  return terminal;
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

export async function stopTerminal(terminal: BackgroundTerminal) {
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
}
