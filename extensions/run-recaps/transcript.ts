import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const MAX_TRANSCRIPT_CHARS = 50_000;

export type BranchEntry = ReturnType<
  ExtensionContext["sessionManager"]["getBranch"]
>[number];

export function textContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const value = block as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string"
        ? value.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolCalls(content: unknown) {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const value = block as Record<string, unknown>;
    if (value.type !== "toolCall" || typeof value.name !== "string") return [];
    // Arguments can contain file contents, credentials, or other sensitive data.
    return [`TOOL CALL ${value.name} (arguments omitted)`];
  });
}

export function serializeRun(entries: readonly BranchEntry[]) {
  const sections: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "user" || message.role === "assistant") {
      const text = textContent(message.content).trim();
      const calls =
        message.role === "assistant" ? toolCalls(message.content) : [];
      if (text || calls.length) {
        sections.push(
          `${message.role.toUpperCase()}:\n${[text, ...calls].filter(Boolean).join("\n")}`,
        );
      }
    } else if (message.role === "toolResult") {
      // Raw tool output is intentionally omitted because it commonly contains
      // source code, environment values, or command output unrelated to a recap.
      sections.push(
        `TOOL RESULT ${message.toolName}: ${message.isError ? "failed" : "completed"} (output omitted)`,
      );
    }
  }

  const transcript = sections.join("\n\n");
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;
  return `[earlier run transcript truncated]\n${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`;
}

export function localFallback(entries: readonly BranchEntry[]) {
  const assistantTexts = entries.flatMap((entry) => {
    if (entry.type !== "message" || entry.message.role !== "assistant")
      return [];
    const text = textContent(entry.message.content).trim();
    return text ? [text] : [];
  });
  const finalText = assistantTexts.at(-1)?.slice(0, 2_000);
  return [
    "### Outcome",
    finalText || "The run completed without a textual assistant response.",
    "",
    "### Note",
    "This local fallback was used because the recap model was unavailable.",
  ].join("\n");
}

export function summaryPrompt(transcript: string) {
  return [
    "Write a concise recap of this single coding-agent run.",
    "Use only facts present in the transcript.",
    "Use these headings when applicable: Outcome, Changes, Verification, Open items.",
    "Mention file paths and commands only when they appear in the transcript.",
    "Do not address the user and do not add recommendations unrelated to the run.",
    "",
    "<run>",
    transcript,
    "</run>",
  ].join("\n");
}
