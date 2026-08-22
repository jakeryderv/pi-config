import type { ChildProcess } from "node:child_process";

export type TerminalStatus = "running" | "exited" | "failed" | "killed";

export interface BackgroundTerminal {
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
