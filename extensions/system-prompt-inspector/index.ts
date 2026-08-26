import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function systemPromptInspectorExtension(pi: ExtensionAPI) {
  pi.registerCommand("dump-system-prompt", {
    description: "Inspect the current effective system prompt",
    handler: async (_args, ctx) => {
      const prompt = ctx.getSystemPrompt();
      await ctx.ui.editor(
        `System prompt · ${prompt.length.toLocaleString()} chars`,
        prompt,
      );
    },
  });
}
