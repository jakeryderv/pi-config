import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Keep command logic independent of Pi's runtime imports and the real clipboard.
export function textFromMessageContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!block || typeof block !== "object" || !("type" in block)) return "";
      if (
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }
      if (block.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function registerCopyAllCommand(
  pi: ExtensionAPI,
  copy: (text: string) => void | Promise<void>,
) {
  pi.registerCommand("copy-all", {
    description: "Copy all user and assistant messages on the active branch",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const sections = ctx.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.message)
        .filter(
          (message) => message.role === "user" || message.role === "assistant",
        )
        .map((message) => ({
          role: message.role.toUpperCase(),
          text: textFromMessageContent(message.content).trim(),
        }))
        .filter(({ text }) => text.length > 0)
        .map(({ role, text }) => `${role}:\n${text}`);

      if (sections.length === 0) {
        ctx.ui.notify("No user or assistant messages to copy", "info");
        return;
      }

      await copy(sections.join("\n\n---\n\n"));
      ctx.ui.notify(`Copied ${sections.length} messages`, "info");
    },
  });
}
