# UI interaction inventory

Repository-owned extensions do not replace Pi's editor, autocomplete, footer, status placement, working indicator, assistant Markdown, or transcript rendering. The remaining interactions use Pi's native UI APIs.

| Owner | Pi API | Interaction | Removing it removes |
| --- | --- | --- | --- |
| `system-prompt-inspector/` | `ctx.ui.editor()` | Native `/dump-system-prompt` inspection dialog | The system-prompt inspection command |
| `copy-all/` | `ctx.ui.notify()` | Native success/empty-result notifications | The `/copy-all` command and its notifications |

## Native appearance configuration

These are supported Pi configuration rather than extension-owned replacements:

- Pi's built-in `system` theme derives colors from the terminal palette; `themes/` holds no custom theme.
- `settings.json` selects editor padding, autocomplete height, fullscreen exit output, and the Markdown code-block rail; fullscreen mode, output padding, and the scrollbar use Pi's defaults.
- `pi-lens.json` selects Pi Lens's compact render mode. MCP uses Pi's built-in rendering.
