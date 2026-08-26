# UI surface ownership

This inventory identifies every repository-owned Pi UI surface, the public API it touches, and the native behavior restored when the owner is removed. Top-level `ui-*` directories are independently auto-discovered extensions; feature extensions keep their optional presentation code beside the feature.

| Owner | Pi API / hook | Surface | Ownership | Removing it restores |
| --- | --- | --- | --- | --- |
| `ui-editor-override/` | `ctx.ui.setEditorComponent()` | Prompt and autocomplete | Replaces Pi's editor renderer to move autocomplete above a rounded prompt surface | Native editor, border, and autocomplete placement |
| `ui-footer-status-override/` | `ctx.ui.setFooter()`, `ctx.ui.custom({ overlay: true })` | Footer and extension statuses | Replaces the footer and relocates package statuses into `/status-panel` | Native footer and native extension-status placement |
| `ui-working-indicator/` | `setWorkingMessage()`, `setHiddenThinkingLabel()`, `setWorkingIndicator()` | Active-response indicator | Replaces Pi's working and hidden-reasoning labels and animation | Native working indicator and labels |
| `ui-assistant-presentation/` | `pi.registerMarkdownTransformer()` | Assistant transcript Markdown | Hides partial prose, normalizes fence aliases, and colors finalized headings | Native streaming and Markdown presentation |
| `ui-response-metrics/` | `pi.registerEntryRenderer()`, `pi.appendEntry()` | TUI-only transcript summary | Adds elapsed time, output-token, and throughput summaries | No per-response summary entry |
| `background-terminals/ui.ts` | `ctx.ui.setWidget()`, `ctx.ui.custom()` | Background-process widget and `/ps` inspector | Adds feature-specific status and inspection UI | Background tools remain, without their widget/inspector |
| `system-prompt-inspector/` | `pi.registerMessageRenderer()` | `/dump-system-prompt` transcript card | Adds a custom message renderer for prompt inspection | No system-prompt inspection card |
| `shared/rounded-surfaces.ts` | pi-tui components through callers | Shared frames and dialogs | Supplies rounded frames, compound surfaces, and custom select/input overlays | Callers must use native Pi surfaces or local rendering |

## Native configuration that also affects appearance

These are supported Pi configuration rather than extension-owned replacements:

- `themes/carbonfox.json` owns the color palette.
- `settings.json` selects fullscreen mode, editor/output padding, autocomplete height, scrollbar behavior, and the Markdown code-block rail.
- `mcp.json`, `pi-lens.json`, and `subagent/config.json` select package-supported compact render modes.

## Non-UI extensions

- `copy-all/` adds `/copy-all` and uses only native notifications.
- `background-terminals/` owns process lifecycle and the `bg_*` tools independently of `background-terminals/ui.ts`.
