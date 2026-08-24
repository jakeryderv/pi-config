import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomEditor,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
  composeEditorSurface,
  createAutocompleteAboveEditor,
  lockEditorBorderColor,
  scrollBorderLabel,
} from "./index.ts";

function createEditor(custom = false): CustomEditor {
  // SAFETY: render() only reads terminal.rows from this focused TUI test double.
  const tui = { terminal: { rows: 24 } } as unknown as TUI;
  // SAFETY: this test injects the autocomplete list, so render() only needs
  // borderColor; the real SelectList theme is never read.
  const theme = {
    borderColor: (text: string) => text,
    selectList: {},
  } as unknown as EditorTheme;
  // SAFETY: keybindings are not consulted while rendering.
  const keybindings = { matches: () => false } as unknown as KeybindingsManager;

  return custom
    ? createAutocompleteAboveEditor(tui, theme, keybindings)
    : new CustomEditor(tui, theme, keybindings);
}

function renderPromptWithSuggestion(editor: CustomEditor): string[] {
  editor.setText("prompt");
  Object.assign(editor, {
    autocompleteState: "regular",
    autocompleteList: { render: () => ["suggestion"] },
  });
  return editor.render(40);
}

test("composeEditorSurface joins autocomplete and prompt in one rounded box", () => {
  assert.deepEqual(
    composeEditorSurface(["──────", "prompt", "──────", "item"], 8, 1, {
      border: (text) => text,
    }),
    ["╭──────╮", "│item  │", "├──────┤", "│prompt│", "╰──────╯"],
  );
});

test("scrollBorderLabel preserves Pi editor overflow hints", () => {
  assert.equal(scrollBorderLabel("────────"), undefined);
  assert.equal(scrollBorderLabel("─── ↑ 2 more ───"), "↑ 2 more");
});

test("custom editor keeps its locked border color across effort updates", () => {
  const editor = createEditor(true);
  lockEditorBorderColor(editor, (text) => `blue:${text}`);

  // Simulate Pi assigning a new effort-level border color.
  editor.borderColor = (text) => `effort:${text}`;

  assert.equal(editor.borderColor("border"), "blue:border");
});

test("custom editor moves Pi's autocomplete rows above the prompt", () => {
  const upstreamLines = renderPromptWithSuggestion(createEditor());
  const customLines = renderPromptWithSuggestion(createEditor(true));
  const suggestionIndex = (lines: string[]) =>
    lines.findIndex((line) => line.includes("suggestion"));
  const promptIndex = (lines: string[]) =>
    lines.findIndex((line) => line.includes("prompt"));

  assert.ok(
    suggestionIndex(upstreamLines) > promptIndex(upstreamLines),
    "upstream editor should demonstrate the below-prompt behavior",
  );
  assert.ok(
    suggestionIndex(customLines) < promptIndex(customLines),
    "custom editor should place suggestions above the prompt",
  );
  assert.match(customLines[0] ?? "", /^╭─+╮$/);
  assert.ok(
    customLines.some((line) => /^├─+┤$/.test(line)),
    "autocomplete and prompt should share a divider",
  );
  assert.match(customLines.at(-1) ?? "", /^╰─+╯$/);
});
