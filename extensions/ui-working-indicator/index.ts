import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function workingIndicatorExtension(pi: ExtensionAPI) {
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
    if (ctx.mode !== "tui") return;
    ctx.ui.setWorkingMessage();
    ctx.ui.setHiddenThinkingLabel();
    ctx.ui.setWorkingIndicator();
  });
}
