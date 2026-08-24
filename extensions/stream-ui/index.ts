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
  stopReason?: string;
}

interface ActivePass extends UsageLike {
  startedAt: number;
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

const CODE_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

const ASSISTANT_HEADING_COLORS = [
  "\x1b[38;2;255;126;182m",
  "\x1b[38;2;190;149;255m",
  "\x1b[38;2;120;169;255m",
  "\x1b[38;2;51;177;255m",
  "\x1b[38;2;61;219;217m",
  "\x1b[38;2;182;184;187m",
] as const;
const RESET_FOREGROUND = "\x1b[39m";

export function normalizeCodeFenceLanguages(markdown: string) {
  const lines = markdown.split("\n");
  let fence: { marker: "`" | "~"; length: number } | undefined;

  return lines
    .map((line) => {
      const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
      if (!match?.[2] || match[3] === undefined) return line;
      const marker = match[2][0] as "`" | "~";
      const remainder = match[3];

      if (fence) {
        if (
          marker === fence.marker &&
          match[2].length >= fence.length &&
          remainder.trim() === ""
        ) {
          fence = undefined;
        }
        return line;
      }

      fence = { marker, length: match[2].length };
      const info = remainder.match(/^([ \t]*)(\S+)(.*)$/);
      if (!info?.[2]) return line;
      const language = CODE_LANGUAGE_ALIASES[info[2].toLowerCase()];
      if (!language) return line;
      return `${match[1]}${match[2]}${info[1]}${language}${info[3]}`;
    })
    .join("\n");
}

export function colorizeAssistantHeadings(markdown: string) {
  const lines = markdown.split("\n");
  let fence: { marker: "`" | "~"; length: number } | undefined;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch?.[1]) {
        const marker = fenceMatch[1][0] as "`" | "~";
        if (!fence) {
          fence = { marker, length: fenceMatch[1].length };
        } else if (
          marker === fence.marker &&
          fenceMatch[1].length >= fence.length &&
          line
            .slice(line.indexOf(fenceMatch[1]) + fenceMatch[1].length)
            .trim() === ""
        ) {
          fence = undefined;
        }
        return line;
      }
      if (fence) return line;

      const heading = line.match(
        /^( {0,3})(#{1,6})([ \t]+)(.*?)([ \t]+#+[ \t]*)?$/,
      );
      if (!heading?.[2] || heading[4] === undefined) return line;
      const level = heading[2].length;
      const color = ASSISTANT_HEADING_COLORS[level - 1];
      const displayHeading = level >= 3 ? "##" : heading[2];
      return `${heading[1]}${displayHeading}${heading[3]}${color}${heading[4]}${RESET_FOREGROUND}${heading[5] ?? ""}`;
    })
    .join("\n");
}

export function finalizeAssistantMarkdown(
  markdown: string,
  context: { messageType: string; isStreaming: boolean },
) {
  if (context.messageType !== "assistant") return markdown;
  if (context.isStreaming) return "";
  return colorizeAssistantHeadings(normalizeCodeFenceLanguages(markdown));
}

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
  let text = `${theme.fg(status.color, status.icon)} ${theme.fg(
    "muted",
    `${status.label} in ${formatPassDuration(summary.durationMs)} · ${formatPassTokens(summary.totalTokens)} tokens`,
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

interface TurnEndEventLike {
  message: {
    role: string;
    usage?: UsageLike;
    stopReason?: string;
  };
  toolResults: readonly { usage?: UsageLike }[];
}

function createResponsePassTracker() {
  let pendingStart: number | undefined;
  let activePass: ActivePass | undefined;

  return {
    recordInput(event: InputEventLike) {
      if (
        event.source === "interactive" &&
        event.streamingBehavior === undefined &&
        activePass === undefined
      ) {
        pendingStart = Date.now();
      }
    },
    start() {
      activePass = emptyPass(pendingStart ?? Date.now());
      pendingStart = undefined;
    },
    recordTurn(event: TurnEndEventLike) {
      if (!activePass) return;
      if (event.message.role === "assistant") {
        addUsage(activePass, event.message.usage);
        activePass.modelCalls++;
        activePass.stopReason = event.message.stopReason;
      }
      for (const result of event.toolResults)
        addUsage(activePass, result.usage);
    },
    settle(): ResponsePassSummary | undefined {
      if (!activePass) return undefined;
      const { startedAt, ...totals } = activePass;
      activePass = undefined;
      return { ...totals, durationMs: Date.now() - startedAt };
    },
    reset() {
      pendingStart = undefined;
      activePass = undefined;
    },
  };
}

export default function streamUiExtension(pi: ExtensionAPI) {
  const tracker = createResponsePassTracker();

  pi.registerMarkdownTransformer(finalizeAssistantMarkdown);

  pi.registerEntryRenderer<ResponsePassSummary>(
    PASS_ENTRY_TYPE,
    (entry, options, theme) =>
      renderPassSummary(entry.data, options.expanded, theme),
  );

  pi.on("input", (event) => tracker.recordInput(event));
  pi.on("before_agent_start", () => tracker.start());
  pi.on("turn_end", (event) => tracker.recordTurn(event));
  pi.on("agent_settled", () => {
    const summary = tracker.settle();
    if (summary) pi.appendEntry(PASS_ENTRY_TYPE, summary);
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWorkingMessage("Working");
    ctx.ui.setHiddenThinkingLabel("Reasoning…");
    ctx.ui.setWorkingIndicator({
      frames: [
        ctx.ui.theme.fg("dim", "·"),
        ctx.ui.theme.fg("muted", "•"),
        ctx.ui.theme.fg("accent", "●"),
        ctx.ui.theme.fg("muted", "•"),
      ],
      intervalMs: 160,
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    tracker.reset();
    if (ctx.mode !== "tui") return;
    ctx.ui.setWorkingMessage();
    ctx.ui.setHiddenThinkingLabel();
    ctx.ui.setWorkingIndicator();
  });
}
