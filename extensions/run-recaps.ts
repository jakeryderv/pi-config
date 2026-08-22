import { uuidv7 } from "@earendil-works/pi-ai";
import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { branchContainsLeaf } from "./lib/session-branch.ts";

const RECAP_ENTRY_TYPE = "automatic-run-recap";
const STATUS_KEY = "run-recaps";
const MAX_TRANSCRIPT_CHARS = 50_000;
const SUMMARY_PROVIDER = "openai-codex";
const SUMMARY_MODEL = "gpt-5.6-luna";

type BranchEntry = ReturnType<
  ExtensionContext["sessionManager"]["getBranch"]
>[number];

interface RecapData {
  markdown: string;
  provider: string;
  model: string;
  fallback: boolean;
  createdAt: number;
}

function textContent(content: unknown) {
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

function summaryPrompt(transcript: string) {
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

export default function automaticRunRecapsExtension(pi: ExtensionAPI) {
  let enabled = true;
  let runStartIndex: number | undefined;
  let sessionActive = false;
  const active = new Map<AbortController, Promise<void>>();

  const updateStatus = (ctx: ExtensionContext) => {
    if (!sessionActive || !ctx.hasUI) return;
    ctx.ui.setStatus(
      STATUS_KEY,
      active.size > 0
        ? ctx.ui.theme.fg("muted", "✦ writing run recap…")
        : undefined,
    );
  };

  pi.registerEntryRenderer<RecapData>(
    RECAP_ENTRY_TYPE,
    (entry, { expanded }, theme) => {
      const data: RecapData = entry.data ?? {
        markdown: "Recap data is unavailable.",
        provider: "unknown",
        model: "unknown",
        fallback: true,
        createdAt: Date.now(),
      };
      const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.addChild(
        new Text(
          `${theme.fg("accent", theme.bold("Run recap"))}${
            data.fallback ? theme.fg("warning", " · local fallback") : ""
          }`,
          0,
          0,
        ),
      );
      box.addChild(new Markdown(data.markdown, 0, 0, getMarkdownTheme()));
      if (expanded) {
        box.addChild(
          new Text(
            theme.fg(
              "dim",
              `${data.provider}/${data.model} · ${new Date(data.createdAt).toLocaleTimeString()}`,
            ),
            0,
            0,
          ),
        );
      }
      return box;
    },
  );

  const createRecap = (
    entries: readonly BranchEntry[],
    ctx: ExtensionContext,
    originLeafId: string | null,
  ) => {
    const controller = new AbortController();
    const task = (async () => {
      let markdown = localFallback(entries);
      let fallback = true;
      let provider = "local";
      let modelId = "fallback";

      try {
        const transcript = serializeRun(entries);
        if (!transcript.trim()) return;
        // Stay on the active provider. Use the cheaper Luna model only when
        // the session is already using openai-codex.
        const model =
          ctx.model?.provider === SUMMARY_PROVIDER
            ? (ctx.modelRegistry.find(SUMMARY_PROVIDER, SUMMARY_MODEL) ??
              ctx.model)
            : ctx.model;
        if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
          throw new Error("No authenticated recap model is available");
        }
        provider = model.provider;
        modelId = model.id;
        const response = await ctx.modelRegistry.complete(
          model,
          {
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: summaryPrompt(transcript) }],
                timestamp: Date.now(),
              },
            ],
          },
          {
            reasoningEffort: "medium",
            cacheRetention: "none",
            sessionId: uuidv7(),
            signal: controller.signal,
          },
        );
        const generated = textContent(response.content).trim();
        if (!generated) throw new Error("The recap model returned no text");
        markdown = generated;
        fallback = false;
      } catch (error) {
        if (controller.signal.aborted || !sessionActive) return;
        console.error("run-recaps: using local fallback", error);
      }

      if (
        !sessionActive ||
        controller.signal.aborted ||
        !branchContainsLeaf(ctx, originLeafId)
      ) {
        return;
      }
      pi.appendEntry<RecapData>(RECAP_ENTRY_TYPE, {
        markdown,
        provider,
        model: modelId,
        fallback,
        createdAt: Date.now(),
      });
    })().finally(() => {
      active.delete(controller);
      updateStatus(ctx);
    });

    active.set(controller, task);
    updateStatus(ctx);
  };

  pi.on("session_start", () => {
    sessionActive = true;
    runStartIndex = undefined;
  });

  pi.on("before_agent_start", (_event, ctx) => {
    if (!enabled || ctx.mode !== "tui") return;
    // The triggering user message has not been persisted yet, so the current
    // length is the exact first index of this run.
    runStartIndex = ctx.sessionManager.getBranch().length;
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!enabled || ctx.mode !== "tui" || runStartIndex !== undefined) return;
    // Extension-triggered runs do not emit before_agent_start.
    runStartIndex = ctx.sessionManager.getBranch().length;
  });

  pi.on("agent_settled", (_event, ctx) => {
    const start = runStartIndex;
    runStartIndex = undefined;
    if (!enabled || start === undefined || ctx.mode !== "tui" || !sessionActive)
      return;
    const entries = ctx.sessionManager.getBranch().slice(start);
    const hasAssistant = entries.some(
      (entry) => entry.type === "message" && entry.message.role === "assistant",
    );
    if (hasAssistant) {
      createRecap(entries, ctx, ctx.sessionManager.getLeafId());
    }
  });

  const cancelBranchBoundWork = () => {
    runStartIndex = undefined;
    for (const controller of active.keys()) controller.abort();
  };
  pi.on("session_before_tree", cancelBranchBoundWork);
  pi.on("session_tree", cancelBranchBoundWork);

  pi.registerCommand("recaps", {
    description: "Toggle automatic post-run recap cards",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      ctx.ui.notify(
        `Automatic run recaps ${enabled ? "enabled" : "disabled"}`,
        "info",
      );
    },
  });

  pi.on("session_shutdown", async () => {
    sessionActive = false;
    runStartIndex = undefined;
    const tasks = [...active.entries()];
    for (const [controller] of tasks) controller.abort();

    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(tasks.map(([, task]) => task)),
        new Promise<void>((resolvePromise) => {
          deadline = setTimeout(resolvePromise, 1_000);
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
      active.clear();
    }
  });
}
