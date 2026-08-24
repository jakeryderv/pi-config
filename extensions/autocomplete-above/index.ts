import {
  CustomEditor,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { frameSurfaceSections, persistentBackground } from "../shared/ui.ts";

interface AutocompleteList {
  render(width: number): string[];
}

interface EditorAutocompleteInternals {
  autocompleteState?: unknown;
  autocompleteList?: AutocompleteList;
}

interface EditorSurfaceStyle {
  border: (text: string) => string;
  background?: (text: string) => string;
  selectedBackground?: (text: string) => string;
}

const editorBackgrounds = new WeakMap<
  CustomEditor,
  Pick<EditorSurfaceStyle, "background" | "selectedBackground">
>();

/** Extract Pi's editor-scroll hint from one of its horizontal borders. */
export function scrollBorderLabel(line: string) {
  const plain = stripTerminalSequences(line);
  if (/^─+$/.test(plain)) return undefined;
  return (
    plain
      .replace(/^─+\s*/, "")
      .replace(/\s*─+$/, "")
      .trim() || undefined
  );
}

export function composeEditorSurface(
  lines: string[],
  width: number,
  autocompleteLineCount: number,
  style: EditorSurfaceStyle,
) {
  const editorLineCount = lines.length - autocompleteLineCount;
  if (editorLineCount < 2) {
    return frameSurfaceSections([lines], width, {
      border: style.border,
      background: style.background,
      paddingX: 0,
    });
  }

  const editorLines = lines.slice(0, editorLineCount);
  const autocompleteLines = lines.slice(editorLineCount);
  const promptLines = editorLines.slice(1, -1);
  const topHint = scrollBorderLabel(editorLines[0] ?? "");
  const bottomHint = scrollBorderLabel(editorLines.at(-1) ?? "");
  const autocompleteActive = autocompleteLineCount > 0;
  const autocompleteBackground =
    style.background || style.selectedBackground
      ? (text: string) => {
          const selected = stripTerminalSequences(text)
            .trimStart()
            .startsWith("→");
          if (selected && style.selectedBackground) {
            return style.selectedBackground(text);
          }
          return style.background?.(text) ?? text;
        }
      : undefined;

  return frameSurfaceSections(
    autocompleteActive ? [autocompleteLines, promptLines] : [promptLines],
    width,
    {
      border: style.border,
      title: autocompleteActive ? undefined : topHint,
      footer: bottomHint,
      dividerLabels: autocompleteActive ? [topHint] : undefined,
      sectionBackgrounds: autocompleteActive
        ? [autocompleteBackground, style.background]
        : [style.background],
      paddingX: 0,
    },
  );
}

/**
 * Pi's Editor renders autocomplete as the final rows of the editor component.
 * In fullscreen mode that places the menu between the prompt and footer, so
 * opening it pushes the prompt upward. Reordering those rows keeps the prompt
 * anchored next to the footer while the menu grows upward.
 *
 * autocompleteState/autocompleteList are currently private Pi TUI fields. The
 * cast is deliberately isolated here so a future upstream placement option or
 * internal rename degrades to Pi's default layout instead of breaking input.
 */
export function lockEditorBorderColor(
  editor: CustomEditor,
  colorBorder: (text: string) => string,
) {
  // Pi updates editor.borderColor whenever the thinking level changes. An
  // instance accessor preserves the public property while intentionally
  // ignoring those later effort-color assignments.
  Object.defineProperty(editor, "borderColor", {
    configurable: true,
    enumerable: true,
    get: () => colorBorder,
    set: () => {},
  });
}

function renderRoundedEditor(
  editor: CustomEditor,
  upstreamRender: (width: number) => string[],
  width: number,
) {
  if (width < 4) return upstreamRender(width);

  const innerWidth = width - 2;
  const lines = upstreamRender(innerWidth);
  // SAFETY: Pi TUI's runtime Editor instance owns these non-# private fields;
  // both are checked before use so an upstream rename falls back safely.
  const internals = editor as unknown as EditorAutocompleteInternals;
  const autocompleteList = internals.autocompleteList;
  const autocompleteActive =
    internals.autocompleteState != null && autocompleteList != null;
  const maxPadding = Math.max(0, Math.floor((innerWidth - 1) / 2));
  const paddingX = Math.min(editor.getPaddingX(), maxPadding);
  const contentWidth = Math.max(1, innerWidth - paddingX * 2);
  const autocompleteLineCount = autocompleteActive
    ? autocompleteList.render(contentWidth).length
    : 0;

  return composeEditorSurface(lines, width, autocompleteLineCount, {
    border: (text) => editor.borderColor(text),
    ...editorBackgrounds.get(editor),
  });
}

export function setEditorSurfaceBackgrounds(
  editor: CustomEditor,
  backgrounds: Pick<EditorSurfaceStyle, "background" | "selectedBackground">,
) {
  editorBackgrounds.set(editor, backgrounds);
}

export function createAutocompleteAboveEditor(
  ...args: ConstructorParameters<typeof CustomEditor>
) {
  const editor = new CustomEditor(...args);
  const upstreamRender = editor.render.bind(editor);
  editor.render = (width) => renderRoundedEditor(editor, upstreamRender, width);
  return editor;
}

export default function autocompleteAboveExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = createAutocompleteAboveEditor(tui, theme, keybindings);
      lockEditorBorderColor(editor, (text) => ctx.ui.theme.fg("accent", text));
      setEditorSurfaceBackgrounds(editor, {
        selectedBackground: (text) =>
          persistentBackground(text, (segment) =>
            ctx.ui.theme.bg("selectedBg", segment),
          ),
      });
      return editor;
    });
  });
}
