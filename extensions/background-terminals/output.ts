import type { BackgroundTerminal } from "./domain.ts";

const MAX_OUTPUT_CHARS = 64 * 1024;
const TOOL_OUTPUT_CHARS = 16 * 1024;

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

export function describe(terminal: BackgroundTerminal) {
  const result =
    terminal.status === "running"
      ? `pid ${terminal.child.pid ?? "?"}`
      : terminal.signal
        ? `signal ${terminal.signal}`
        : `exit ${terminal.exitCode ?? "?"}`;
  return `${terminal.id} [${terminal.status}] ${terminal.title} · ${result} · ${elapsed(terminal)}`;
}

export function combinedOutput(terminal: BackgroundTerminal) {
  const parts: string[] = [];
  if (terminal.stdout.trim())
    parts.push(`STDOUT\n${terminal.stdout.trimEnd()}`);
  if (terminal.stderr.trim())
    parts.push(`STDERR\n${terminal.stderr.trimEnd()}`);
  return parts.join("\n\n") || "(no output)";
}

export function toolReport(terminal: BackgroundTerminal) {
  const output = combinedOutput(terminal);
  const visible =
    output.length > TOOL_OUTPUT_CHARS
      ? `[output truncated to final ${TOOL_OUTPUT_CHARS} characters]\n${output.slice(-TOOL_OUTPUT_CHARS)}`
      : output;
  return `${describe(terminal)}\ncommand: ${sanitizeOutput(terminal.command)}\ncwd: ${sanitizeOutput(terminal.cwd)}\n\n${visible}`;
}
