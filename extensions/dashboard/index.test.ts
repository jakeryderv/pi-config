import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { columns, formatDirectory, formatTokens } from "./format.ts";
import { parsePullRequest } from "./git.ts";

test("dashboard formats compact values", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_500), "1.5k");
  assert.equal(formatTokens(15_000), "15k");
  assert.equal(formatTokens(1_500_000), "1.5m");
  assert.equal(formatDirectory(homedir()), "~");
  assert.equal(formatDirectory(`${homedir()}/code/project`), "~/code/project");
  assert.equal(columns("left", "right", 12), "left   right");
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
