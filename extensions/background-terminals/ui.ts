import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { frameSurface, selectSurface } from "../shared/rounded-surfaces.ts";
import type { BackgroundTerminal } from "./domain.ts";
import { combinedOutput, describe, sanitizeOutput } from "./output.ts";

const WIDGET_KEY = "background-terminals";

export function updateBackgroundTerminalWidget(
  ctx: ExtensionContext | undefined,
  runningCount: number,
) {
  if (!ctx?.hasUI) return;
  if (runningCount === 0) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  ctx.ui.setWidget(
    WIDGET_KEY,
    (_tui, theme) =>
      new Text(
        `${theme.fg("accent", "●")} ${runningCount} background terminal${runningCount === 1 ? "" : "s"} running ${theme.fg("dim", "·")} ${theme.fg("accent", "/ps")}`,
        0,
        0,
      ),
  );
}

export function clearBackgroundTerminalWidget(
  ctx: ExtensionContext | undefined,
) {
  if (ctx?.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export async function inspectBackgroundTerminals(
  ctx: ExtensionCommandContext,
  terminals: readonly BackgroundTerminal[],
) {
  if (terminals.length === 0) {
    ctx.ui.notify("No background terminals", "info");
    return;
  }

  const labels = terminals.map(describe);
  const selected = await selectSurface(ctx.ui, "Background terminals", labels);
  if (!selected) return;
  const terminal = terminals[labels.indexOf(selected)];
  if (!terminal) return;

  await ctx.ui.custom((_tui, theme, _keybindings, done) => {
    const view = new Text(
      `${theme.fg("dim", `${sanitizeOutput(terminal.cwd)}\n${sanitizeOutput(terminal.command)}`)}\n\n${combinedOutput(terminal)}`,
      0,
      0,
    );
    return {
      render: (width: number) =>
        frameSurface(view.render(Math.max(1, width - 4)), width, {
          border: (text) => theme.fg("border", text),
          title: theme.bold(theme.fg("accent", describe(terminal))),
          footer: theme.fg("dim", "Enter or Esc to close"),
          paddingX: 1,
        }),
      invalidate: () => view.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
          done(undefined);
        }
      },
    };
  });
}
