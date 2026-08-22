import { homedir } from "node:os";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface GitState {
  branch: string;
  changedFiles: number;
  pullRequest: { number: number; url: string } | null;
}

const EMPTY_GIT: GitState = { branch: "", changedFiles: 0, pullRequest: null };
const GIT_REFRESH_MS = 5_000;
const PR_REFRESH_MS = 60_000;

function formatTokens(tokens: number) {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000)
    return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~/${relative(home, cwd)}` : cwd;
}

function columns(left: string, right: string, width: number) {
  if (!right) return truncateToWidth(left, width);
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap > 0) return `${left}${" ".repeat(gap)}${right}`;

  const leftWidth = Math.max(1, Math.floor(width * 0.48));
  const rightWidth = Math.max(1, width - leftWidth - 1);
  const fittedLeft = truncateToWidth(left, leftWidth);
  const fittedRight = truncateToWidth(right, rightWidth);
  return `${fittedLeft} ${fittedRight}`;
}

function sessionCost(ctx: ExtensionContext) {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += entry.message.usage.cost.total;
    }
  }
  return cost;
}

function parsePullRequest(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      number?: unknown;
      url?: unknown;
      state?: unknown;
    };
    if (
      parsed.state === "OPEN" &&
      typeof parsed.number === "number" &&
      typeof parsed.url === "string"
    ) {
      return { number: parsed.number, url: parsed.url };
    }
  } catch {
    // gh can fail or produce non-JSON output when there is no pull request.
  }
  return null;
}

export default function dashboardExtension(pi: ExtensionAPI) {
  let gitState = EMPTY_GIT;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let refreshInFlight = false;
  let render: (() => void) | undefined;
  let lastPrBranch = "";
  let lastPrRefresh = 0;
  let assistantMessageStarted = 0;
  let tokensPerSecond: number | null = null;
  let generation = 0;

  const refreshGit = async (ctx: ExtensionContext, forcePr = false) => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    const refreshGeneration = generation;
    try {
      const inside = await pi.exec(
        "git",
        ["rev-parse", "--is-inside-work-tree"],
        { cwd: ctx.cwd, timeout: 3_000 },
      );
      if (refreshGeneration !== generation) return;
      if (inside.code !== 0 || inside.stdout.trim() !== "true") {
        gitState = EMPTY_GIT;
        render?.();
        return;
      }

      const [branchResult, headResult, statusResult] = await Promise.all([
        pi.exec("git", ["branch", "--show-current"], {
          cwd: ctx.cwd,
          timeout: 3_000,
        }),
        pi.exec("git", ["rev-parse", "--short", "HEAD"], {
          cwd: ctx.cwd,
          timeout: 3_000,
        }),
        pi.exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
          cwd: ctx.cwd,
          timeout: 3_000,
        }),
      ]);
      if (refreshGeneration !== generation) return;

      const namedBranch = branchResult.stdout.trim();
      const branch =
        namedBranch || `detached@${headResult.stdout.trim() || "?"}`;
      const changedFiles = statusResult.stdout
        .split("\n")
        .filter((line) => line.length > 0).length;
      const branchChanged = namedBranch !== lastPrBranch;
      gitState = {
        branch,
        changedFiles,
        pullRequest: branchChanged ? null : gitState.pullRequest,
      };
      render?.();

      const now = Date.now();
      if (
        namedBranch &&
        (forcePr || branchChanged || now - lastPrRefresh >= PR_REFRESH_MS)
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
          // Git status remains useful when gh is absent or unauthenticated.
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
    } finally {
      refreshInFlight = false;
    }
  };

  const installFooter = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
      render = () => tui.requestRender();
      return {
        invalidate() {},
        dispose() {
          render = undefined;
        },
        render(width: number) {
          const usage = ctx.getContextUsage();
          const contextPercent =
            usage?.percent === null || usage?.percent === undefined
              ? "?%"
              : `${Math.round(usage.percent)}%`;
          const contextWindow =
            usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const cost = sessionCost(ctx);
          const speed =
            tokensPerSecond === null
              ? "— tok/s"
              : `${Math.round(tokensPerSecond)} tok/s`;
          const model = ctx.model
            ? `${ctx.model.provider}/${ctx.model.id} · ${pi.getThinkingLevel()}`
            : "no model";
          const git = gitState.branch
            ? `${gitState.branch} · ${gitState.changedFiles} changed${
                gitState.pullRequest
                  ? ` · PR #${gitState.pullRequest.number}`
                  : ""
              }`
            : "";

          const lines = [
            columns(
              theme.fg("text", formatDirectory(ctx.cwd)),
              theme.fg("muted", model),
              width,
            ),
            columns(
              theme.fg(
                "muted",
                `${contextPercent}/${formatTokens(contextWindow)} · $${cost.toFixed(3)} · ${speed}`,
              ),
              theme.fg("muted", git),
              width,
            ),
          ];

          const statuses = footerData.getExtensionStatuses();
          for (const [, status] of [...statuses.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            for (const statusLine of status.split("\n")) {
              lines.push(truncateToWidth(statusLine, width));
            }
          }
          return lines;
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
    tokensPerSecond = null;
    installFooter(ctx);
    void refreshGit(ctx, true);
    refreshTimer = setInterval(() => void refreshGit(ctx), GIT_REFRESH_MS);
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant")
      assistantMessageStarted = Date.now();
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const elapsedMs = Date.now() - assistantMessageStarted;
    if (elapsedMs >= 100 && event.message.usage.output > 0) {
      tokensPerSecond = event.message.usage.output / (elapsedMs / 1_000);
    }
    render?.();
  });

  pi.on("model_select", () => render?.());
  pi.on("thinking_level_select", () => render?.());
  pi.on("turn_end", () => render?.());
  pi.on("input", (_event, ctx) => {
    void refreshGit(ctx);
    return { action: "continue" };
  });
  pi.on("tool_execution_end", (_event, ctx) => void refreshGit(ctx));

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
    refreshTimer = undefined;
    render = undefined;
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
