import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

type SystemPromptDetails = {
  prompt: string;
  chars: number;
};

export default function dumpSystemPromptExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer<SystemPromptDetails>("system-prompt-inspection", (message, _options, theme) => {
    const details = message.details;
    const prompt = details?.prompt ?? "<system prompt unavailable>";
    const chars = details?.chars ?? prompt.length;

    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    const title = theme.fg("customMessageLabel", "\x1b[1m[system prompt]\x1b[22m");
    const meta = theme.fg("dim", ` ${chars.toLocaleString()} chars`);
    box.addChild(new Text(`${title}${meta}\n\n${prompt}`, 0, 0));
    return box;
  });

  pi.registerCommand("dump-system-prompt", {
    description: "Show the current effective system prompt in chat",
    handler: async (_args, ctx) => {
      const prompt = ctx.getSystemPrompt();
      pi.sendMessage({
        customType: "system-prompt-inspection",
        content: "System prompt inspection output. Ignore this for task context.",
        display: true,
        details: { prompt, chars: prompt.length },
      });
    },
  });
}
