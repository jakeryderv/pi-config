import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatTokens } from "../shared/format.ts";

const PASS_ENTRY_TYPE = "response-pass-summary";

interface UsageLike {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface ResponsePassSummary extends UsageLike {
  durationMs: number;
  modelCalls: number;
  tokensPerSecond: number | null;
  stopReason?: string;
}

interface ActivePass extends UsageLike {
  startedAt: number;
  generationMs: number;
  modelCalls: number;
  stopReason?: string;
}

function emptyPass(startedAt: number): ActivePass {
  return {
    startedAt,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    generationMs: 0,
    modelCalls: 0,
  };
}

function addUsage(pass: ActivePass, usage: UsageLike | undefined) {
  if (!usage) return;
  pass.input += usage.input;
  pass.output += usage.output;
  pass.cacheRead += usage.cacheRead;
  pass.cacheWrite += usage.cacheWrite;
  pass.totalTokens += usage.totalTokens;
}

export function formatPassDuration(durationMs: number) {
  const seconds = Math.max(0, durationMs) / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export const formatPassTokens = formatTokens;

function passStatus(summary: ResponsePassSummary) {
  if (summary.stopReason === "error")
    return { icon: "×", label: "Failed", color: "error" } as const;
  if (summary.stopReason === "aborted")
    return { icon: "■", label: "Stopped", color: "warning" } as const;
  return { icon: "✓", label: "Responded", color: "success" } as const;
}

function renderPassSummary(
  summary: ResponsePassSummary | undefined,
  expanded: boolean,
  theme: Theme,
) {
  if (!summary) return undefined;
  const status = passStatus(summary);
  const speed =
    summary.tokensPerSecond === null || summary.tokensPerSecond === undefined
      ? "— tok/s"
      : `${Math.round(summary.tokensPerSecond)} tok/s`;
  const headline = `${status.label} in ${formatPassDuration(summary.durationMs)} · ${formatPassTokens(summary.output)} tokens · ${speed}`;
  let text = `${theme.fg(status.color, status.icon)} ${theme.fg(
    "muted",
    headline,
  )}`;
  if (expanded) {
    const details = [
      `${formatPassTokens(summary.input)} input`,
      `${formatPassTokens(summary.output)} output`,
    ];
    if (summary.cacheRead > 0)
      details.push(`${formatPassTokens(summary.cacheRead)} cache read`);
    if (summary.cacheWrite > 0)
      details.push(`${formatPassTokens(summary.cacheWrite)} cache write`);
    details.push(
      `${summary.modelCalls} model call${summary.modelCalls === 1 ? "" : "s"}`,
    );
    text += `\n${theme.fg("dim", details.join(" · "))}`;
  }
  return new Text(text, 1, 0);
}

interface InputEventLike {
  source: string;
  streamingBehavior?: string;
}

interface AssistantMessageEventLike {
  message: {
    role: string;
    usage?: UsageLike;
  };
}

interface TurnEndEventLike {
  message: {
    role: string;
    usage?: UsageLike;
    stopReason?: string;
  };
}

interface ResponsePassTrackerState {
  pendingStart?: number;
  activePass?: ActivePass;
  assistantMessageStartedAt?: number;
}

function recordPassInput(
  state: ResponsePassTrackerState,
  event: InputEventLike,
) {
  if (
    event.source === "interactive" &&
    event.streamingBehavior === undefined &&
    state.activePass === undefined
  ) {
    state.pendingStart = Date.now();
  }
}

function startResponsePass(state: ResponsePassTrackerState) {
  state.activePass = emptyPass(state.pendingStart ?? Date.now());
  state.pendingStart = undefined;
  state.assistantMessageStartedAt = undefined;
}

function recordAssistantStart(
  state: ResponsePassTrackerState,
  event: AssistantMessageEventLike,
) {
  if (state.activePass && event.message.role === "assistant") {
    state.assistantMessageStartedAt = Date.now();
  }
}

function recordAssistantEnd(
  state: ResponsePassTrackerState,
  event: AssistantMessageEventLike,
) {
  if (event.message.role !== "assistant") return;
  if (
    state.activePass &&
    state.assistantMessageStartedAt !== undefined &&
    (event.message.usage?.output ?? 0) > 0
  ) {
    state.activePass.generationMs += Math.max(
      0,
      Date.now() - state.assistantMessageStartedAt,
    );
  }
  state.assistantMessageStartedAt = undefined;
}

function recordResponseTurn(
  state: ResponsePassTrackerState,
  event: TurnEndEventLike,
) {
  if (!state.activePass || event.message.role !== "assistant") return;
  addUsage(state.activePass, event.message.usage);
  state.activePass.modelCalls++;
  state.activePass.stopReason = event.message.stopReason;
}

function settleResponsePass(
  state: ResponsePassTrackerState,
): ResponsePassSummary | undefined {
  if (!state.activePass) return undefined;
  const { startedAt, generationMs, ...totals } = state.activePass;
  state.activePass = undefined;
  state.assistantMessageStartedAt = undefined;
  return {
    ...totals,
    durationMs: Date.now() - startedAt,
    tokensPerSecond:
      totals.output > 0 && generationMs > 0
        ? totals.output / (generationMs / 1_000)
        : null,
  };
}

function resetResponsePass(state: ResponsePassTrackerState) {
  state.pendingStart = undefined;
  state.activePass = undefined;
  state.assistantMessageStartedAt = undefined;
}

export default function responseMetricsExtension(pi: ExtensionAPI) {
  const tracker: ResponsePassTrackerState = {};

  pi.registerEntryRenderer<ResponsePassSummary>(
    PASS_ENTRY_TYPE,
    (entry, options, theme) =>
      renderPassSummary(entry.data, options.expanded, theme),
  );

  pi.on("input", (event) => recordPassInput(tracker, event));
  pi.on("before_agent_start", () => startResponsePass(tracker));
  pi.on("message_start", (event) => recordAssistantStart(tracker, event));
  pi.on("message_end", (event) => recordAssistantEnd(tracker, event));
  pi.on("turn_end", (event) => recordResponseTurn(tracker, event));
  pi.on("agent_settled", () => {
    const summary = settleResponsePass(tracker);
    if (summary) pi.appendEntry(PASS_ENTRY_TYPE, summary);
  });
  pi.on("session_shutdown", () => resetResponsePass(tracker));
}
