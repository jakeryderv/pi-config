import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { BackgroundTerminal } from "./domain.ts";
import { combinedOutput, describe, sanitizeOutput } from "./output.ts";

export async function inspectBackgroundTerminals(
  ctx: ExtensionCommandContext,
  terminals: readonly BackgroundTerminal[],
) {
  if (terminals.length === 0) {
    ctx.ui.notify("No background terminals", "info");
    return;
  }

  const labels = terminals.map(describe);
  const selected = await ctx.ui.select("Background terminals", labels);
  if (!selected) return;
  const terminal = terminals[labels.indexOf(selected)];
  if (!terminal) return;

  const details = [
    `cwd: ${sanitizeOutput(terminal.cwd)}`,
    `command: ${sanitizeOutput(terminal.command)}`,
    "",
    combinedOutput(terminal),
  ].join("\n");
  await ctx.ui.editor(describe(terminal), details);
}
