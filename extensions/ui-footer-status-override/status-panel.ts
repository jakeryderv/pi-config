import type {
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  sliceByColumn,
  stripTerminalSequences,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { frameSurface } from "../shared/rounded-surfaces.ts";

const EMPTY_STATUSES = new Map<string, string>();

type StatusTone =
  | "success"
  | "active"
  | "warning"
  | "error"
  | "idle"
  | "neutral";
type StatusEntry = readonly [string, string];

export function statusLabel(key: string) {
  switch (key) {
    case "fff":
      return "FFF";
    case "mcp":
      return "MCP";
    case "mcp-auth":
      return "MCP auth";
    case "pi-lens-lsp":
      return "LSP";
    case "subagent-slash":
    case "subagent-slash-text":
      return "Subagents";
    default:
      return (key.startsWith("wf:") ? key.slice(3) : key)
        .split(/[-_:]+/)
        .flatMap((part) =>
          part ? [part.charAt(0).toUpperCase() + part.slice(1)] : [],
        )
        .join(" ");
  }
}

export function sortedStatuses(statuses: ReadonlyMap<string, string>) {
  return [...statuses.entries()]
    .filter(([, status]) => status.trim().length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

export function statusTone(status: string): StatusTone {
  const value = stripTerminalSequences(status).toLowerCase();
  if (/\b(error|failed|failure|unavailable|disconnected)\b/.test(value)) {
    return "error";
  }
  if (
    /\b(warning|degraded|needs? auth|authentication required)\b/.test(value)
  ) {
    return "warning";
  }
  if (/\b(connecting|starting|running|queued|pending|active)\b/.test(value)) {
    return "active";
  }
  if (/\b(connected|ready|healthy|ok)\b/.test(value)) return "success";
  if (/\b(inactive|idle|disabled|off)\b/.test(value)) return "idle";
  return "neutral";
}

function statusValue(key: string, status: string) {
  let value = stripTerminalSequences(status)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (key === "mcp") value = value.replace(/^(?:🔌\s*)?MCP\s*:\s*/i, "");
  if (key === "pi-lens-lsp") value = value.replace(/^LSP\s*/i, "");
  if (key.startsWith("wf:")) {
    const workflowPrefix = `${key.slice(3)}:`;
    if (value.toLowerCase().startsWith(workflowPrefix.toLowerCase())) {
      value = value.slice(workflowPrefix.length).trimStart();
    }
  }
  return value;
}

function statusGroup(key: string) {
  if (key === "fff" || key.startsWith("mcp") || key === "pi-lens-lsp") {
    return "Services";
  }
  if (key.startsWith("wf:") || key.startsWith("subagent-")) return "Activity";
  return "Other";
}

function groupedStatuses(statuses: readonly StatusEntry[]) {
  const groups = new Map<string, StatusEntry[]>();
  for (const entry of statuses) {
    const group = statusGroup(entry[0]);
    const values = groups.get(group) ?? [];
    values.push(entry);
    groups.set(group, values);
  }
  return ["Services", "Activity", "Other"].flatMap((group) => {
    const entries = groups.get(group);
    return entries ? [{ group, entries }] : [];
  });
}

function toneIcon(theme: Theme, tone: StatusTone) {
  switch (tone) {
    case "success":
      return theme.fg("success", "●");
    case "active":
      return theme.fg("accent", "◐");
    case "warning":
      return theme.fg("warning", "●");
    case "error":
      return theme.fg("error", "●");
    case "idle":
      return theme.fg("dim", "○");
    case "neutral":
    default:
      return theme.fg("muted", "●");
  }
}

function fitLabel(label: string, width: number) {
  if (visibleWidth(label) <= width) return label;
  return `${sliceByColumn(label, 0, Math.max(0, width - 1), true)}…`;
}

function statusRows(
  theme: Theme,
  [key, status]: StatusEntry,
  contentWidth: number,
  labelWidth: number,
) {
  const label = fitLabel(statusLabel(key), labelWidth);
  const labelPadding = " ".repeat(
    Math.max(0, labelWidth - visibleWidth(label)),
  );
  const icon = toneIcon(theme, statusTone(status));
  const prefix = `${icon} ${theme.fg("muted", label)}${labelPadding}  `;
  const valueWidth = Math.max(1, contentWidth - labelWidth - 4);
  const values = wrapTextWithAnsi(statusValue(key, status), valueWidth);
  return values.map((value, index) =>
    index === 0
      ? `${prefix}${theme.fg("text", value)}`
      : `${" ".repeat(labelWidth + 4)}${theme.fg("text", value)}`,
  );
}

function statusContent(
  theme: Theme,
  statuses: readonly StatusEntry[],
  contentWidth: number,
) {
  if (statuses.length === 0) {
    return [theme.fg("dim", "No extension statuses")];
  }

  const labelWidth = Math.min(
    15,
    Math.max(...statuses.map(([key]) => visibleWidth(statusLabel(key)))),
  );
  const content: string[] = [];
  const groups = groupedStatuses(statuses);
  groups.forEach(({ group, entries }, groupIndex) => {
    if (groupIndex > 0) content.push("");
    if (groups.length > 1) {
      content.push(theme.bold(theme.fg("dim", group)));
    }
    for (const entry of entries) {
      content.push(...statusRows(theme, entry, contentWidth, labelWidth));
    }
  });
  return content;
}

export function createExtensionStatusPanel(
  theme: Theme,
  getFooterData: () => ReadonlyFooterDataProvider | undefined,
): Component {
  return {
    render(width: number) {
      if (width < 4) return [];
      const statuses = sortedStatuses(
        getFooterData()?.getExtensionStatuses() ?? EMPTY_STATUSES,
      );
      return frameSurface(
        statusContent(theme, statuses, Math.max(1, width - 4)),
        width,
        {
          border: (text) => theme.fg("border", text),
          title: theme.bold(theme.fg("accent", "Extensions")),
          footer: theme.fg("dim", "/status-panel"),
          paddingX: 1,
        },
      );
    },
    invalidate() {},
  };
}
