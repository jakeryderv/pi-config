import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Input,
  SelectList,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export interface SurfaceFrameOptions {
  border: (text: string) => string;
  title?: string;
  footer?: string;
  dividerLabels?: readonly (string | undefined)[];
  paddingX?: number;
  background?: (text: string) => string;
  sectionBackgrounds?: readonly (((text: string) => string) | undefined)[];
}

function paintBackground(
  text: string,
  background: ((text: string) => string) | undefined,
) {
  return background ? persistentBackground(text, background) : text;
}

function labeledBorder(
  width: number,
  corners: readonly [string, string],
  options: SurfaceFrameOptions,
  label?: string,
) {
  const [left, right] = corners;
  const innerWidth = Math.max(0, width - 2);
  if (!label || innerWidth < 4) {
    const border = options.border(`${left}${"─".repeat(innerWidth)}${right}`);
    return paintBackground(border, options.background);
  }

  const fittedLabel = truncateToWidth(label, innerWidth - 3, "…");
  const trailingWidth = Math.max(0, innerWidth - visibleWidth(fittedLabel) - 3);
  const border = `${options.border(`${left}─ `)}${fittedLabel}${options.border(` ${"─".repeat(trailingWidth)}${right}`)}`;
  return paintBackground(border, options.background);
}

function framedRows(
  lines: readonly string[],
  width: number,
  options: SurfaceFrameOptions,
  sectionIndex: number,
) {
  const innerWidth = Math.max(0, width - 2);
  const paddingX = Math.min(
    Math.max(0, options.paddingX ?? 1),
    Math.floor(innerWidth / 2),
  );
  const contentWidth = Math.max(0, innerWidth - paddingX * 2);
  const side = options.border("│");
  const paintedSide = paintBackground(side, options.background);
  const horizontalPadding = " ".repeat(paddingX);

  return lines.map((line) => {
    const content = truncateToWidth(line, contentWidth, "");
    const trailing = " ".repeat(
      Math.max(0, contentWidth - visibleWidth(content)),
    );
    const body = `${horizontalPadding}${content}${trailing}${horizontalPadding}`;
    const background =
      options.sectionBackgrounds?.[sectionIndex] ?? options.background;
    return `${paintedSide}${paintBackground(body, background)}${paintedSide}`;
  });
}

/** Frame one or more sections with the shared rounded terminal-surface style. */
export function frameSurfaceSections(
  sections: readonly (readonly string[])[],
  width: number,
  options: SurfaceFrameOptions,
): string[] {
  if (width < 2) return [];

  const rendered = [labeledBorder(width, ["╭", "╮"], options, options.title)];
  sections.forEach((section, index) => {
    rendered.push(...framedRows(section, width, options, index));
    if (index < sections.length - 1) {
      rendered.push(
        labeledBorder(
          width,
          ["├", "┤"],
          options,
          options.dividerLabels?.[index],
        ),
      );
    }
  });
  rendered.push(labeledBorder(width, ["╰", "╯"], options, options.footer));
  return rendered;
}

export function frameSurface(
  lines: readonly string[],
  width: number,
  options: SurfaceFrameOptions,
) {
  return frameSurfaceSections([lines], width, options);
}

/** Reapply a background after full ANSI resets emitted by cursor renderers. */
export function persistentBackground(
  text: string,
  background: (segment: string) => string,
) {
  return text.split("\u001b[0m").map(background).join("\u001b[0m");
}

interface SurfaceDialogOptions {
  signal?: AbortSignal;
  width?: number;
}

function surfaceSelectTheme(theme: Theme) {
  return {
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("text", text),
    description: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("muted", text),
    noMatch: (text: string) => theme.fg("muted", text),
  };
}

const DIALOG_OVERLAY = {
  overlay: true,
  overlayOptions: {
    anchor: "center" as const,
    width: 56,
    minWidth: 40,
    maxHeight: "70%" as const,
    margin: 1,
  },
};

/** Show an extension-owned selector using the shared floating-surface style. */
export async function selectSurface(
  ui: ExtensionUIContext,
  title: string,
  options: readonly string[],
  dialogOptions: SurfaceDialogOptions = {},
) {
  if (dialogOptions.signal?.aborted) return undefined;

  let cancel: (() => void) | undefined;
  const result = ui.custom<string | undefined>(
    (tui, theme, _keybindings, done) => {
      let settled = false;
      const finish = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        done(value);
      };
      cancel = () => finish(undefined);

      const availableRows = Math.max(
        1,
        Math.floor(tui.terminal.rows * 0.7) - 2,
      );
      const list = new SelectList(
        options.map((value) => ({ value, label: value })),
        Math.min(options.length, availableRows, 8),
        surfaceSelectTheme(theme),
      );
      list.onSelect = (item) => finish(item.value);
      list.onCancel = () => finish(undefined);

      return {
        render: (width: number) => {
          const contentWidth = Math.max(1, width - 4);
          const titleFits = visibleWidth(title) <= width - 5;
          const sections = titleFits
            ? [list.render(contentWidth)]
            : [
                wrapTextWithAnsi(
                  theme.bold(theme.fg("text", title)),
                  contentWidth,
                ),
                list.render(contentWidth),
              ];
          const selectedBackground = (text: string) =>
            stripTerminalSequences(text).trimStart().startsWith("→")
              ? theme.bg("selectedBg", text)
              : text;
          return frameSurfaceSections(sections, width, {
            border: (text) => theme.fg("accent", text),
            sectionBackgrounds: titleFits
              ? [selectedBackground]
              : [undefined, selectedBackground],
            title: theme.bold(theme.fg("accent", titleFits ? title : "Select")),
            footer: theme.fg("dim", "↑↓ navigate · Enter select · Esc close"),
            paddingX: 1,
          });
        },
        invalidate: () => list.invalidate(),
        handleInput: (data: string) => list.handleInput(data),
      } satisfies Component;
    },
    {
      ...DIALOG_OVERLAY,
      overlayOptions: {
        ...DIALOG_OVERLAY.overlayOptions,
        width: dialogOptions.width ?? DIALOG_OVERLAY.overlayOptions.width,
      },
    },
  );

  const abort = () => cancel?.();
  dialogOptions.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await result;
  } finally {
    dialogOptions.signal?.removeEventListener("abort", abort);
  }
}

/** Show a single-line extension-owned editor using the shared surface style. */
export function inputSurface(
  ui: ExtensionUIContext,
  title: string,
  initialValue = "",
) {
  return ui.custom<string | undefined>((_tui, theme, _keybindings, done) => {
    const input = new Input();
    input.setValue(initialValue);
    input.focused = true;
    input.onSubmit = (value) => done(value);
    input.onEscape = () => done(undefined);

    return {
      render: (width: number) =>
        frameSurface(input.render(Math.max(1, width - 4)), width, {
          border: (text) => theme.fg("accent", text),
          title: theme.bold(theme.fg("accent", title)),
          footer: theme.fg("dim", "Enter submit · Esc close"),
          paddingX: 1,
        }),
      invalidate: () => input.invalidate(),
      handleInput: (data: string) => input.handleInput(data),
    } satisfies Component;
  }, DIALOG_OVERLAY);
}
