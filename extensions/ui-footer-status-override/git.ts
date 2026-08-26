import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface GitState {
  branch: string;
  detached: boolean;
  changedFiles: number;
  pullRequest: { number: number; url: string } | null;
}

export const EMPTY_GIT: GitState = {
  branch: "",
  detached: false,
  changedFiles: 0,
  pullRequest: null,
};

export const GIT_MUTATING_TOOLS = new Set([
  "ast_grep_replace",
  "bash",
  "edit",
  "subagent",
  "workflow",
  "write",
]);

export async function inspectGitState(
  pi: Pick<ExtensionAPI, "exec">,
  ctx: Pick<ExtensionContext, "cwd">,
  providerBranch: string,
): Promise<GitState | null> {
  const detached = providerBranch === "detached";
  const statusPromise = pi.exec(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: ctx.cwd, timeout: 3_000 },
  );
  const headPromise = detached
    ? pi.exec("git", ["rev-parse", "--short", "HEAD"], {
        cwd: ctx.cwd,
        timeout: 3_000,
      })
    : Promise.resolve(undefined);
  const [statusResult, headResult] = await Promise.all([
    statusPromise,
    headPromise,
  ]);
  if (statusResult.code !== 0) return null;

  return {
    branch: detached
      ? `detached@${headResult?.stdout.trim() || "?"}`
      : providerBranch,
    detached,
    changedFiles: statusResult.stdout
      .split("\n")
      .filter((line) => line.length > 0).length,
    pullRequest: null,
  };
}

export function parsePullRequest(value: string) {
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
