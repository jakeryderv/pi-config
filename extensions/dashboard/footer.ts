import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { columns, formatDirectory, formatTokens } from "./format.ts";
import type { GitState } from "./git.ts";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type FooterDensity = "wide" | "compact" | "minimal";

export function thinkingThemeColor(level: ThinkingLevel) {
  switch (level) {
    case "minimal":
      return "thinkingMinimal" as const;
    case "low":
      return "thinkingLow" as const;
    case "medium":
      return "thinkingMedium" as const;
    case "high":
      return "thinkingHigh" as const;
    case "xhigh":
      return "thinkingXhigh" as const;
    case "max":
      return "thinkingMax" as const;
    case "off":
    default:
      return "thinkingOff" as const;
  }
}

export function contextThemeColor(percent: number | null | undefined) {
  if (percent !== null && percent !== undefined && percent > 90)
    return "error" as const;
  if (percent !== null && percent !== undefined && percent > 70)
    return "warning" as const;
  return "muted" as const;
}

export function footerDensity(width: number): FooterDensity {
  if (width >= 100) return "wide";
  if (width >= 68) return "compact";
  return "minimal";
}

function modelIdentity(ctx: ExtensionContext, density: FooterDensity) {
  if (!ctx.model) return "no model";
  if (density === "wide") return `${ctx.model.provider}/${ctx.model.id}`;
  return ctx.model.id;
}

function modelDisplay(
  ctx: ExtensionContext,
  theme: Theme,
  density: FooterDensity,
  thinkingLevel: ThinkingLevel,
) {
  const identity = theme.fg("muted", modelIdentity(ctx, density));
  if (!ctx.model) return identity;
  return `${identity}${theme.fg(
    thinkingThemeColor(thinkingLevel),
    ` · ${thinkingLevel}`,
  )}`;
}

function locationDisplay(
  ctx: ExtensionContext,
  theme: Theme,
  density: FooterDensity,
) {
  const directory = theme.fg("text", formatDirectory(ctx.cwd));
  const sessionName = ctx.sessionManager.getSessionName();
  if (density === "minimal" || !sessionName) return directory;
  return `${directory}${theme.fg("muted", ` · ${sessionName}`)}`;
}

function gitDisplay(gitState: GitState, theme: Theme, density: FooterDensity) {
  if (!gitState.branch) return "";

  const parts = [
    theme.fg(gitState.detached ? "warning" : "muted", gitState.branch),
  ];
  if (density === "minimal") {
    if (gitState.changedFiles > 0) {
      parts.push(theme.fg("warning", `+${gitState.changedFiles}`));
    }
  } else {
    parts.push(
      gitState.changedFiles > 0
        ? theme.fg("warning", `${gitState.changedFiles} changed`)
        : theme.fg("success", "clean"),
    );
  }
  if (density === "wide" && gitState.pullRequest) {
    parts.push(theme.fg("accent", `PR #${gitState.pullRequest.number}`));
  }
  return parts.join(theme.fg("muted", " · "));
}

function statsDisplay(options: {
  contextPercent: number | null | undefined;
  contextWindow: number;
  cachedTokens: number;
  cachedCost: number;
  density: FooterDensity;
  theme: Theme;
}) {
  const contextDisplay =
    options.contextPercent === null || options.contextPercent === undefined
      ? `?/${formatTokens(options.contextWindow)}`
      : `${Math.round(options.contextPercent)}%/${formatTokens(options.contextWindow)}`;
  const parts = [
    options.theme.fg(contextThemeColor(options.contextPercent), contextDisplay),
    options.theme.fg("muted", `${formatTokens(options.cachedTokens)} tokens`),
    options.theme.fg("muted", `$${options.cachedCost.toFixed(3)}`),
  ];
  return parts.join(options.theme.fg("muted", " · "));
}

export function renderDashboardFooter(options: {
  ctx: ExtensionContext;
  theme: Theme;
  gitState: GitState;
  cachedTokens: number;
  cachedCost: number;
  thinkingLevel: ThinkingLevel;
  width: number;
}) {
  const usage = options.ctx.getContextUsage();
  const density = footerDensity(options.width);
  const contextWindow =
    usage?.contextWindow ?? options.ctx.model?.contextWindow ?? 0;
  const location = locationDisplay(options.ctx, options.theme, density);
  const model = modelDisplay(
    options.ctx,
    options.theme,
    density,
    options.thinkingLevel,
  );
  const stats = statsDisplay({
    contextPercent: usage?.percent,
    contextWindow,
    cachedTokens: options.cachedTokens,
    cachedCost: options.cachedCost,
    density,
    theme: options.theme,
  });
  const git = gitDisplay(options.gitState, options.theme, density);
  return [
    columns(location, model, options.width),
    columns(stats, git, options.width),
  ];
}
