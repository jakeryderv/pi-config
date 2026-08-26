# UI interaction inventory

Repository-owned extensions no longer replace Pi's editor, autocomplete, footer, status placement, working indicator, assistant Markdown, or transcript rendering. The remaining interactions use Pi's native UI APIs.

| Owner | Pi API | Interaction | Removing it removes |
| --- | --- | --- | --- |
| `background-terminals/ui.ts` | `ctx.ui.select()`, `ctx.ui.editor()`, `ctx.ui.notify()` | Native `/ps` terminal selection and output inspection | Only the `/ps` inspection UI; the `bg_*` tools and process lifecycle are separate |
| `system-prompt-inspector/` | `ctx.ui.editor()` | Native `/dump-system-prompt` inspection dialog | The system-prompt inspection command |
| `copy-all/` | `ctx.ui.notify()` | Native success/empty-result notifications | The `/copy-all` command and its notifications |

## Native appearance configuration

These are supported Pi configuration rather than extension-owned replacements:

- `themes/carbonfox.json` owns the color palette.
- `settings.json` selects fullscreen mode, editor/output padding, autocomplete height, scrollbar behavior, and the Markdown code-block rail.
- `mcp.json`, `pi-lens.json`, and `subagent/config.json` select package-supported compact render modes.

## Shared support

- `shared/session-branch.ts` protects background-terminal completion delivery when conversation branch navigation has moved away from the terminal's origin.
