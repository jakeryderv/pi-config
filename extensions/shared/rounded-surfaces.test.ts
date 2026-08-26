import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  frameSurface,
  frameSurfaceSections,
  persistentBackground,
} from "./rounded-surfaces.ts";

const plain = (text: string) => text;

test("frameSurface uses rounded corners and integrated labels", () => {
  const lines = frameSurface(["ready"], 24, {
    border: plain,
    title: "Status",
    footer: "Esc close",
    paddingX: 1,
  });

  assert.match(lines[0] ?? "", /^╭─ Status ─+╮$/);
  assert.match(lines[1] ?? "", /^│ ready +│$/);
  assert.match(lines.at(-1) ?? "", /^╰─ Esc close ─+╯$/);
  assert.ok(lines.every((line) => visibleWidth(line) === 24));
});

test("frameSurface emits background styling for every frame segment", () => {
  const background = (text: string) => `\u001b[48;5;1m${text}\u001b[49m`;
  const lines = frameSurface(["ready"], 12, {
    border: plain,
    background,
  });

  assert.ok(lines.every((line) => line.startsWith("\u001b[48;5;1m")));
  assert.ok(lines.every((line) => line.endsWith("\u001b[49m")));
  assert.ok(lines.every((line) => visibleWidth(line) === 12));
});

test("persistentBackground restores card color after cursor resets", () => {
  assert.equal(
    persistentBackground("before\u001b[0mafter", (part) => `[${part}]`),
    "[before]\u001b[0m[after]",
  );
});

test("frameSurfaceSections joins related content with one divider", () => {
  assert.deepEqual(
    frameSurfaceSections([["suggestion"], ["prompt"]], 14, {
      border: plain,
      paddingX: 0,
    }),
    [
      "╭────────────╮",
      "│suggestion  │",
      "├────────────┤",
      "│prompt      │",
      "╰────────────╯",
    ],
  );
});
