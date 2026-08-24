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

export function sessionCost(ctx: ExtensionContext) {
  let cost = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += entry.message.usage.cost.total;
    } else if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.usage
    ) {
      cost += entry.message.usage.cost.total;
    } else if (
      (entry.type === "branch_summary" || entry.type === "compaction") &&
      entry.usage
    ) {
      cost += entry.usage.cost.total;
    }
  }
  return cost;
}

export function smoothRate(
  previous: number | null,
  sample: number,
  alpha = 0.35,
) {
  if (previous === null) return sample;
  return previous * (1 - alpha) + sample * alpha;
}
