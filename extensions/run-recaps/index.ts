import { uuidv7 } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { branchContainsLeaf } from "../shared/session-branch.ts";
import {
  RECAP_ENTRY_TYPE,
  registerRecapRenderer,
  type RecapData,
} from "./renderer.ts";
import {
  localFallback,
  serializeRun,
  summaryPrompt,
  textContent,
  type BranchEntry,
} from "./transcript.ts";

export { localFallback, serializeRun } from "./transcript.ts";

const STATUS_KEY = "run-recaps";
const SUMMARY_PROVIDER = "openai-codex";
const SUMMARY_MODEL = "gpt-5.6-luna";

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

  registerRecapRenderer(pi);

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
