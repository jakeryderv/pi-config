import { homedir } from "node:os";
import { relative } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export { formatTokens } from "../shared/format.ts";

export function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~/${relative(home, cwd)}` : cwd;
}

export function columns(left: string, right: string, width: number) {
  if (!right) return truncateToWidth(left, width);
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap > 0) return `${left}${" ".repeat(gap)}${right}`;

  const leftWidth = Math.max(1, Math.floor(width * 0.48));
  const rightWidth = Math.max(1, width - leftWidth - 1);
  const fittedLeft = truncateToWidth(left, leftWidth);
  const fittedRight = truncateToWidth(right, rightWidth);
  return `${fittedLeft} ${fittedRight}`;
}

export function sessionUsage(ctx: ExtensionContext) {
  let cost = 0;
  let tokens = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    let usage;
    if (entry.type === "message" && entry.message.role === "assistant") {
      usage = entry.message.usage;
    } else if (
      entry.type === "message" &&
      entry.message.role === "toolResult"
    ) {
      usage = entry.message.usage;
    } else if (entry.type === "branch_summary" || entry.type === "compaction") {
      usage = entry.usage;
    }
    if (!usage) continue;
    cost += usage.cost.total;
    tokens += usage.totalTokens;
  }
  return { cost, tokens };
}

export function sessionCost(ctx: ExtensionContext) {
  return sessionUsage(ctx).cost;
}

export function sessionTokens(ctx: ExtensionContext) {
  return sessionUsage(ctx).tokens;
}
