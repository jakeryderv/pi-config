import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  columns,
  formatDirectory,
  formatTokens,
  sessionCost,
  sessionTokens,
} from "./format.ts";
import {
  GIT_MUTATING_TOOLS,
  inspectGitState,
  parsePullRequest,
} from "./git.ts";
import {
  contextThemeColor,
  footerDensity,
  renderFooterOverride,
  thinkingThemeColor,
} from "./footer.ts";
import {
  createExtensionStatusPanel,
  sortedStatuses,
  statusLabel,
  statusTone,
} from "./status-panel.ts";

test("footer override formats compact values", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_500), "1.5k");
  assert.equal(formatTokens(15_000), "15k");
  assert.equal(formatTokens(1_500_000), "1.5m");
  assert.equal(formatDirectory(homedir()), "~");
  assert.equal(formatDirectory(`${homedir()}/code/project`), "~/code/project");
  assert.equal(columns("left", "right", 12), "left   right");
});

test("status panel labels and sorts installed-package statuses", () => {
  const statuses = new Map([
    ["pi-lens-lsp", "LSP Active: typescript"],
    ["mcp", "1 server connected"],
    ["empty", ""],
  ]);

  assert.equal(statusLabel("mcp"), "MCP");
  assert.equal(statusLabel("pi-lens-lsp"), "LSP");
  assert.equal(statusTone("1 server connected"), "success");
  assert.equal(statusTone("LSP Active: typescript"), "active");
  assert.equal(statusTone("LSP Failed: rust-analyzer"), "error");
  assert.deepEqual(
    sortedStatuses(statuses).map(([key]) => key),
    ["mcp", "pi-lens-lsp"],
  );
});

test("status panel renders package statuses in a bordered panel", () => {
  // SAFETY: the panel renderer uses only fg(), bg(), and bold() from the theme.
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
  // SAFETY: the panel reads only getExtensionStatuses().
  const footerData = {
    getExtensionStatuses: () =>
      new Map([
        ["mcp", "1 server connected"],
        ["pi-lens-lsp", "LSP Active: typescript"],
      ]),
  } as unknown as ReadonlyFooterDataProvider;
  const lines = createExtensionStatusPanel(theme, () => footerData).render(36);
  const rendered = lines.join("\n");

  assert.match(lines[0] ?? "", /^╭─ Extensions ─+╮$/);
  assert.match(rendered, /MCP/);
  assert.match(rendered, /LSP/);
  assert.match(rendered, /\/status-panel/);
});

test("footer override includes nested and summary model usage", () => {
  const entries = [
    {
      type: "message",
      message: {
        role: "assistant",
        usage: { cost: { total: 1 }, totalTokens: 100 },
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        usage: { cost: { total: 0.5 }, totalTokens: 50 },
      },
    },
    {
      type: "compaction",
      usage: { cost: { total: 0.25 }, totalTokens: 25 },
    },
    {
      type: "branch_summary",
      usage: { cost: { total: 0.125 }, totalTokens: 10 },
    },
  ];
  // SAFETY: usage helpers read only sessionManager.getEntries() and usage totals.
  const ctx = {
    sessionManager: { getEntries: () => entries },
  } as unknown as ExtensionContext;

  assert.equal(sessionCost(ctx), 1.875);
  assert.equal(sessionTokens(ctx), 185);
});

test("footer override selects responsive density", () => {
  assert.equal(footerDensity(120), "wide");
  assert.equal(footerDensity(80), "compact");
  assert.equal(footerDensity(60), "minimal");
});

test("footer override removes secondary details at narrow widths", () => {
  // SAFETY: footer rendering uses only fg() from this theme test double.
  const theme = {
    fg: (_color: string, text: string) => text,
  } as unknown as Theme;
  // SAFETY: footer rendering reads only these context and session fields.
  const ctx = {
    cwd: "/repo",
    model: {
      provider: "provider",
      id: "model",
      contextWindow: 128_000,
    },
    getContextUsage: () => ({ percent: 50, contextWindow: 128_000 }),
    sessionManager: { getSessionName: () => "session" },
  } as unknown as ExtensionContext;
  const state = {
    ctx,
    theme,
    gitState: {
      branch: "main",
      detached: false,
      changedFiles: 0,
      pullRequest: { number: 42, url: "https://example.test/42" },
    },
    cachedCost: 0.125,
    cachedTokens: 1_500,
    thinkingLevel: "high" as const,
  };

  const wide = renderFooterOverride({ ...state, width: 120 }).join("\n");
  const narrow = renderFooterOverride({ ...state, width: 60 }).join("\n");
  assert.match(wide, /provider\/model/);
  assert.match(wide, /session/);
  assert.match(wide, /1\.5k tokens/);
  assert.doesNotMatch(wide, /tok\/s/);
  assert.match(narrow, /1\.5k tokens/);
  assert.match(wide, /PR #42/);
  assert.doesNotMatch(narrow, /provider\//);
  assert.doesNotMatch(narrow, /session/);
  assert.doesNotMatch(narrow, /tok\/s/);
  assert.doesNotMatch(narrow, /PR #42/);
});

test("footer override colors context pressure by threshold", () => {
  assert.equal(contextThemeColor(undefined), "muted");
  assert.equal(contextThemeColor(70), "muted");
  assert.equal(contextThemeColor(71), "warning");
  assert.equal(contextThemeColor(91), "error");
});

test("footer override refreshes Git only after likely mutating tools", () => {
  assert.equal(GIT_MUTATING_TOOLS.has("read"), false);
  assert.equal(GIT_MUTATING_TOOLS.has("ffgrep"), false);
  assert.equal(GIT_MUTATING_TOOLS.has("edit"), true);
  assert.equal(GIT_MUTATING_TOOLS.has("bash"), true);
  assert.equal(GIT_MUTATING_TOOLS.has("subagent"), true);
});

test("footer override inspects normal Git state with one subprocess", async () => {
  const calls: string[][] = [];
  // SAFETY: inspectGitState uses only the exec method and its standard result fields.
  const pi = {
    async exec(_command: string, args: string[]) {
      calls.push(args);
      return {
        stdout: " M README.md\n?? new.ts\n",
        stderr: "",
        code: 0,
        killed: false,
      };
    },
  } as unknown as Pick<ExtensionAPI, "exec">;

  assert.deepEqual(await inspectGitState(pi, { cwd: "/repo" }, "main"), {
    branch: "main",
    detached: false,
    changedFiles: 2,
    pullRequest: null,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], "status");
});

test("footer override resolves a detached Git revision separately", async () => {
  const calls: string[][] = [];
  // SAFETY: inspectGitState uses only the exec method and its standard result fields.
  const pi = {
    async exec(_command: string, args: string[]) {
      calls.push(args);
      return {
        stdout: args[0] === "status" ? "" : "abc123\n",
        stderr: "",
        code: 0,
        killed: false,
      };
    },
  } as unknown as Pick<ExtensionAPI, "exec">;

  assert.deepEqual(await inspectGitState(pi, { cwd: "/repo" }, "detached"), {
    branch: "detached@abc123",
    detached: true,
    changedFiles: 0,
    pullRequest: null,
  });
  assert.equal(calls.length, 2);
});

test("footer override maps effort levels to theme colors", () => {
  const levels = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ] as const;

  assert.deepEqual(
    levels.map((level) => thinkingThemeColor(level)),
    [
      "thinkingOff",
      "thinkingMinimal",
      "thinkingLow",
      "thinkingMedium",
      "thinkingHigh",
      "thinkingXhigh",
      "thinkingMax",
    ],
  );
});

test("parsePullRequest accepts only open pull requests", () => {
  assert.deepEqual(
    parsePullRequest(
      '{"number":42,"url":"https://example.test/42","state":"OPEN"}',
    ),
    { number: 42, url: "https://example.test/42" },
  );
  assert.equal(
    parsePullRequest(
      '{"number":42,"url":"https://example.test/42","state":"CLOSED"}',
    ),
    null,
  );
  assert.equal(parsePullRequest("not json"), null);
});
