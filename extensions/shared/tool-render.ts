import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";

export interface StandardToolRenderState {
  startedAt?: number;
  finishedAt?: number;
}

class CompactToolText implements Component {
  private lines: string[];

  constructor(lines: readonly string[] = []) {
    this.lines = [...lines];
  }

  setLines(lines: readonly string[]) {
    this.lines = [...lines];
  }

  render(width: number) {
    return this.lines.map((line) =>
      truncateToWidth(line, Math.max(0, width), ""),
    );
  }

  invalidate() {}
}

interface ToolResultLike {
  content: readonly { type: string; text?: string }[];
}

interface StandardToolRenderContext {
  executionStarted: boolean;
  isPartial: boolean;
  isError: boolean;
  state: StandardToolRenderState;
  lastComponent: Component | undefined;
}

interface StandardToolResultOptions {
  expanded: boolean;
  isPartial: boolean;
}

export function formatToolDuration(durationMs: number) {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return durationMs < 10_000
    ? `${(durationMs / 1_000).toFixed(1)}s`
    : `${Math.round(durationMs / 1_000)}s`;
}

function elapsedLabel(state: StandardToolRenderState) {
  if (state.startedAt === undefined) return "";
  return formatToolDuration((state.finishedAt ?? Date.now()) - state.startedAt);
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function toolContentMetadata(content: ToolResultLike["content"]) {
  const texts = content.flatMap((item) =>
    item.type === "text" && item.text !== undefined ? [item.text] : [],
  );
  const images = content.filter((item) => item.type === "image").length;
  const metadata: string[] = [];

  if (texts.length > 0) {
    const text = texts.join("\n");
    const lineCount = text.length === 0 ? 0 : text.split("\n").length;
    if (lineCount > 0)
      metadata.push(`${lineCount} line${lineCount === 1 ? "" : "s"}`);
    metadata.push(formatBytes(Buffer.byteLength(text)));
  }
  if (images > 0) metadata.push(`${images} image${images === 1 ? "" : "s"}`);

  return metadata;
}

function resultIcon(theme: Theme, context: StandardToolRenderContext) {
  return context.isError ? theme.fg("error", "×") : theme.fg("success", "✓");
}

function compactComponent(
  context: StandardToolRenderContext,
  lines: readonly string[],
) {
  const component =
    context.lastComponent instanceof CompactToolText
      ? context.lastComponent
      : new CompactToolText();
  component.setLines(lines);
  return component;
}

export function renderStandardToolCall(options: {
  label: string;
  detail?: string;
  theme: Theme;
  context: StandardToolRenderContext;
}) {
  if (
    options.context.executionStarted &&
    options.context.state.startedAt === undefined
  ) {
    options.context.state.startedAt = Date.now();
  }

  const header = [options.theme.fg("muted", options.label)];
  if (options.detail) header.push(options.theme.fg("dim", options.detail));

  const lines = [header.join(options.theme.fg("dim", " · "))];
  if (options.context.isPartial) {
    const status = options.context.executionStarted ? "◐ Running" : "○ Queued";
    const elapsed = options.context.executionStarted
      ? elapsedLabel(options.context.state)
      : "";
    lines.push(
      options.theme.fg("dim", elapsed ? `${status} · ${elapsed}` : status),
    );
  }

  return compactComponent(options.context, lines);
}

export function renderStandardToolResult(options: {
  result: ToolResultLike;
  renderOptions: StandardToolResultOptions;
  theme: Theme;
  context: StandardToolRenderContext;
  collapsedLines?: number;
  summary?: string;
  expansionHint?: string;
}) {
  if (options.renderOptions.isPartial)
    return compactComponent(options.context, []);

  if (
    options.context.state.startedAt !== undefined &&
    options.context.state.finishedAt === undefined
  ) {
    options.context.state.finishedAt = Date.now();
  }

  const metadata = options.summary ? [options.summary] : [];
  const elapsed = elapsedLabel(options.context.state);
  if (elapsed) metadata.push(elapsed);
  metadata.push(...toolContentMetadata(options.result.content));
  if (metadata.length === 0) metadata.push("Completed");

  return compactComponent(options.context, [
    `${resultIcon(options.theme, options.context)} ${options.theme.fg(
      "dim",
      metadata.join(" · "),
    )}`,
  ]);
}
