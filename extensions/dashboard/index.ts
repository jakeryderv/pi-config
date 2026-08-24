import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { sessionCost, smoothRate } from "./format.ts";
import { renderDashboardFooter } from "./footer.ts";
import {
  EMPTY_GIT,
  GIT_MUTATING_TOOLS,
  inspectGitState,
  parsePullRequest,
} from "./git.ts";
import { createExtensionStatusPanel } from "./status-panel.ts";

const GIT_REFRESH_MS = 30_000;
const GIT_REFRESH_DEBOUNCE_MS = 250;
const PR_REFRESH_MS = 5 * 60_000;
const SPEED_SMOOTHING_ALPHA = 0.35;

export default function dashboardExtension(pi: ExtensionAPI) {
  let gitState = EMPTY_GIT;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let render: (() => void) | undefined;
  let lastPrBranch = "";
  let lastPrRefresh = 0;
  let assistantMessageStarted = 0;
  let tokensPerSecond: number | null = null;
  let cachedCost = 0;
  let generation = 0;
  let footerDataProvider: ReadonlyFooterDataProvider | undefined;
  let closeStatusPanel: (() => void) | undefined;
  let statusPanelGeneration = 0;

  let gitRefreshQueued = false;
  let queuedForcePr = false;
  let queuedGitContext: ExtensionContext | undefined;
  let gitRefreshDrain: Promise<void> | undefined;

  const performGitRefresh = async (ctx: ExtensionContext, forcePr = false) => {
    const refreshGeneration = generation;
    const providerBranch = footerDataProvider?.getGitBranch();
    if (!providerBranch) {
      gitState = EMPTY_GIT;
      lastPrBranch = "";
      render?.();
      return;
    }

    try {
      const inspectedState = await inspectGitState(pi, ctx, providerBranch);
      if (refreshGeneration !== generation) return;
      if (!inspectedState) {
        gitState = EMPTY_GIT;
        render?.();
        return;
      }

      const namedBranch = inspectedState.detached ? "" : providerBranch;
      const branchChanged = inspectedState.branch !== gitState.branch;
      gitState = {
        ...inspectedState,
        pullRequest: branchChanged ? null : gitState.pullRequest,
      };
      render?.();

      if (!namedBranch) {
        lastPrBranch = "";
        return;
      }

      const now = Date.now();
      if (
        forcePr ||
        branchChanged ||
        namedBranch !== lastPrBranch ||
        now - lastPrRefresh >= PR_REFRESH_MS
      ) {
        lastPrBranch = namedBranch;
        lastPrRefresh = now;
        try {
          const pr = await pi.exec(
            "gh",
            ["pr", "view", namedBranch, "--json", "number,url,state"],
            { cwd: ctx.cwd, timeout: 10_000 },
          );
          if (refreshGeneration !== generation) return;
          gitState = {
            ...gitState,
            pullRequest: pr.code === 0 ? parsePullRequest(pr.stdout) : null,
          };
        } catch {
          if (refreshGeneration === generation) {
            gitState = { ...gitState, pullRequest: null };
          }
        }
        render?.();
      }
    } catch {
      if (refreshGeneration === generation) {
        gitState = EMPTY_GIT;
        render?.();
      }
    }
  };

  const refreshGit = (ctx: ExtensionContext, forcePr = false) => {
    queuedGitContext = ctx;
    gitRefreshQueued = true;
    queuedForcePr ||= forcePr;

    if (!gitRefreshDrain) {
      gitRefreshDrain = (async () => {
        while (gitRefreshQueued && queuedGitContext) {
          const nextContext = queuedGitContext;
          const nextForcePr = queuedForcePr;
          gitRefreshQueued = false;
          queuedForcePr = false;
          await performGitRefresh(nextContext, nextForcePr);
        }
      })().finally(() => {
        gitRefreshDrain = undefined;
      });
    }

    return gitRefreshDrain;
  };

  const scheduleGitRefresh = (ctx: ExtensionContext, forcePr = false) => {
    queuedForcePr ||= forcePr;
    if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
    const refreshGeneration = generation;
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = undefined;
      if (refreshGeneration !== generation) return;
      const scheduledForcePr = queuedForcePr;
      queuedForcePr = false;
      void refreshGit(ctx, scheduledForcePr);
    }, GIT_REFRESH_DEBOUNCE_MS);
    refreshDebounceTimer.unref?.();
  };

  const updateCachedCost = (ctx: ExtensionContext) => {
    cachedCost = sessionCost(ctx);
  };

  const hideStatusPanel = () => {
    if (!closeStatusPanel) return false;
    const close = closeStatusPanel;
    closeStatusPanel = undefined;
    statusPanelGeneration += 1;
    close();
    return true;
  };

  const showStatusPanel = (ctx: ExtensionCommandContext) => {
    const panelGeneration = ++statusPanelGeneration;
    const panel = ctx.ui.custom<undefined>(
      (_tui, theme, _keybindings, done) => {
        closeStatusPanel = () => done(undefined);
        return createExtensionStatusPanel(theme, () => footerDataProvider);
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "top-right",
          width: 46,
          minWidth: 38,
          maxHeight: "80%",
          margin: 1,
          nonCapturing: true,
        },
      },
    );

    void panel
      .catch((error) => {
        ctx.ui.notify(
          `Could not open status panel: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      })
      .finally(() => {
        if (panelGeneration === statusPanelGeneration) {
          closeStatusPanel = undefined;
        }
      });
  };

  const installFooter = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
      footerDataProvider = footerData;
      const unsubscribeBranch = footerData.onBranchChange(() =>
        scheduleGitRefresh(ctx, true),
      );
      render = () => tui.requestRender();
      return {
        invalidate() {},
        dispose() {
          unsubscribeBranch();
          footerDataProvider = undefined;
          render = undefined;
        },
        render(width: number) {
          return renderDashboardFooter({
            ctx,
            theme,
            gitState,
            cachedCost,
            tokensPerSecond,
            thinkingLevel: pi.getThinkingLevel(),
            width,
          });
        },
      };
    });
  };

  pi.on("session_start", (_event, ctx) => {
    generation += 1;
    if (ctx.mode !== "tui") return;
    gitState = EMPTY_GIT;
    lastPrBranch = "";
    lastPrRefresh = 0;
    assistantMessageStarted = 0;
    tokensPerSecond = null;
    updateCachedCost(ctx);
    installFooter(ctx);
    void refreshGit(ctx, true);
    refreshTimer = setInterval(() => scheduleGitRefresh(ctx), GIT_REFRESH_MS);
    refreshTimer.unref?.();
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") {
      assistantMessageStarted = Date.now();
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role === "assistant") {
      const elapsedMs = Date.now() - assistantMessageStarted;
      if (
        assistantMessageStarted > 0 &&
        elapsedMs >= 100 &&
        event.message.usage.output > 0
      ) {
        const sample = event.message.usage.output / (elapsedMs / 1_000);
        tokensPerSecond = smoothRate(
          tokensPerSecond,
          sample,
          SPEED_SMOOTHING_ALPHA,
        );
      }
    }
    if (
      event.message.role === "assistant" ||
      event.message.role === "toolResult"
    ) {
      updateCachedCost(ctx);
    }
    render?.();
  });

  pi.on("model_select", () => {
    tokensPerSecond = null;
    assistantMessageStarted = 0;
    render?.();
  });
  pi.on("thinking_level_select", () => render?.());
  pi.on("session_info_changed", () => render?.());
  pi.on("session_compact", (_event, ctx) => {
    updateCachedCost(ctx);
    render?.();
  });
  pi.on("session_tree", (_event, ctx) => {
    updateCachedCost(ctx);
    render?.();
  });
  pi.on("turn_end", () => render?.());
  pi.on("tool_execution_end", (event, ctx) => {
    if (GIT_MUTATING_TOOLS.has(event.toolName)) scheduleGitRefresh(ctx);
  });

  pi.registerCommand("status-panel", {
    description: "Toggle the right-side extension status panel",
    handler: (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "The status panel is available only in TUI mode",
          "warning",
        );
        return Promise.resolve();
      }
      if (!hideStatusPanel()) showStatusPanel(ctx);
      return Promise.resolve();
    },
  });

  pi.registerCommand("pr", {
    description: "Refresh dashboard Git and pull-request information",
    handler: async (_args, ctx) => {
      await refreshGit(ctx, true);
      if (!gitState.branch) ctx.ui.notify("Not a Git repository", "warning");
      else if (gitState.pullRequest) {
        ctx.ui.notify(
          `PR #${gitState.pullRequest.number}: ${gitState.pullRequest.url}`,
          "info",
        );
      } else ctx.ui.notify(`No open PR found for ${gitState.branch}`, "info");
    },
  });

  pi.on("session_shutdown", (_event, ctx) => {
    generation += 1;
    if (refreshTimer) clearInterval(refreshTimer);
    if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
    refreshTimer = undefined;
    refreshDebounceTimer = undefined;
    gitRefreshQueued = false;
    queuedForcePr = false;
    queuedGitContext = undefined;
    footerDataProvider = undefined;
    hideStatusPanel();
    render = undefined;
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
