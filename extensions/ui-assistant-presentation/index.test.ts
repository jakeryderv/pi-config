import assert from "node:assert/strict";
import test from "node:test";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import {
  colorizeAssistantHeadings,
  finalizeAssistantMarkdown,
  normalizeCodeFenceLanguages,
} from "./index.ts";

test("assistant prose stays hidden until its message is finalized", () => {
  const streaming = { messageType: "assistant", isStreaming: true };
  const finalized = { messageType: "assistant", isStreaming: false };
  assert.equal(finalizeAssistantMarkdown("response", streaming), "");
  assert.equal(finalizeAssistantMarkdown("response", finalized), "response");
  assert.equal(
    finalizeAssistantMarkdown("user text", {
      messageType: "user",
      isStreaming: true,
    }),
    "user text",
  );
});

test("final assistant code fences use canonical language names", () => {
  const markdown = [
    "```ts",
    "const value = 42;",
    "```not-a-closing-fence",
    "### still code",
    "```",
    "~~~py",
    "print('ok')",
    "~~~",
  ].join("\n");

  assert.equal(
    normalizeCodeFenceLanguages(markdown),
    [
      "```typescript",
      "const value = 42;",
      "```not-a-closing-fence",
      "### still code",
      "```",
      "~~~python",
      "print('ok')",
      "~~~",
    ].join("\n"),
  );
});

test("final assistant headings receive distinct colors without H3+ hashes", () => {
  const markdown = [
    "# One",
    "## Two",
    "### Three",
    "#### Four",
    "##### Five",
    "###### Six",
    "```md",
    "# Literal",
    "```",
  ].join("\n");

  assert.equal(
    colorizeAssistantHeadings(markdown),
    [
      "# \u001b[38;2;255;126;182mOne\u001b[39m",
      "## \u001b[38;2;190;149;255mTwo\u001b[39m",
      "## \u001b[38;2;120;169;255mThree\u001b[39m",
      "## \u001b[38;2;51;177;255mFour\u001b[39m",
      "## \u001b[38;2;61;219;217mFive\u001b[39m",
      "## \u001b[38;2;182;184;187mSix\u001b[39m",
      "```md",
      "# Literal",
      "```",
    ].join("\n"),
  );
});

test("Pi's Markdown renderer preserves finalized heading colors", () => {
  const identity = (text: string) => text;
  const theme: MarkdownTheme = {
    heading: identity,
    link: identity,
    linkUrl: identity,
    code: identity,
    codeBlock: identity,
    codeBlockBorder: identity,
    quote: identity,
    quoteBorder: identity,
    hr: identity,
    listBullet: identity,
    bold: identity,
    italic: identity,
    strikethrough: identity,
    underline: identity,
  };
  const rendered = new Markdown(
    colorizeAssistantHeadings("# One\n## Two\n### Three"),
    0,
    0,
    theme,
  )
    .render(80)
    .join("\n");

  assert.match(rendered, /\u001b\[38;2;255;126;182mOne\u001b\[39m/);
  assert.match(rendered, /\u001b\[38;2;190;149;255mTwo\u001b\[39m/);
  assert.match(rendered, /\u001b\[38;2;120;169;255mThree\u001b\[39m/);
  assert.doesNotMatch(rendered, /###/);
});
