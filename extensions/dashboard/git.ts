export interface GitState {
  branch: string;
  changedFiles: number;
  pullRequest: { number: number; url: string } | null;
}

export const EMPTY_GIT: GitState = {
  branch: "",
  changedFiles: 0,
  pullRequest: null,
};

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
