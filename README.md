# pi-config

Global config for the [Pi coding agent](https://github.com/badlogic/pi-mono),
deployed into `~/.pi/agent/` (plus the Pi Lens config path) as symlinks. Formerly the `pi` package of my
dotfiles repo; split out because the custom extensions have grown into a real
TypeScript project.

Only **user-authored** config is tracked here; secrets and tool-managed state
stay in the live `~/.pi/` dir, which this repo never owns wholesale — each
top-level entry is linked individually so pi's runtime files remain ordinary
local files beside the links.

| Tracked | Tool-managed / secret (stays in `~/.pi/`, NOT tracked) |
| --- | --- |
| `AGENTS.md` — global agent instructions | `auth.json` — credentials |
| `settings.json` — provider/model defaults, scoped model cycling, installed `packages` | `npm/`, `git/` — Pi's package installations, regenerated from `settings.json` |
| `keybindings.json` — user keybinding overrides (currently none) | — |
| `mcp.json` — MCP servers (`context7` hosted remote) and compact MCP result rendering | `sessions/`, `mcp-cache.json`, `models-store.json`, `run-history.jsonl`, `intercom/`, `trust.json` — runtime state |
| `pi-lens.json` — tracked Pi Lens preferences, linked to `~/.pi-lens/config.json` | the rest of `~/.pi-lens/` — logs, caches, downloaded binaries, and other extension state |
| `extensions/` — custom TS extensions, subagent display preferences, and development lockfile | `fff/`, `pi-hermes-memory/`, `projects-memory/`, `missions/`, `tmp/` — extension state |
| `themes/` — custom TUI theme (`carbonfox.json`; selected in `settings.json`) | `~/.pi/artifacts/`, `workflows/`, `web-search-cache/`, `rules/` — generated state |
| `skills/` — Pi-only skills; shared skills come from `~/.agents/skills/` | `~/.pi/web-search.json` (provider keys), `exa-usage.json` — machine-local state |
| `prompts/` — prompt templates | — |

> **Note:** `settings.json` is written by pi at runtime (`lastChangelogVersion`
> on updates, plus model/thinking/`enabledModels` changes from `/settings` and
> the model picker), so it will show up dirty in `git status`. Commit when a
> change is intentional; `git restore settings.json` to drop noise.

## Activate

```bash
just apply    # symlink tracked config into Pi's live config paths
just status   # show what is linked / missing / shadowed
just unlink   # remove the symlinks (only ones pointing into this repo)
```

Directories (`extensions/`, `skills/`, `prompts/`, `themes/`) are linked whole,
so new files created in the repo — or from the live side under
`~/.pi/agent/extensions/` etc. — appear in both places immediately. `pi-lens.json`
is linked separately to `~/.pi-lens/config.json`; Pi Lens keeps its generated
state beside that link. Anything pi-side tools drop into the linked directories
lands in the repo working tree; `.gitignore` is the filter.

Fresh-machine order: install Node + git + just → install the Pi CLI → clone
this repo → `just apply` → run Pi (it installs the tracked `packages` and
prompts for provider login) → add optional external dependencies as needed
(language servers, Chromium, Exa key).

## Custom extensions

| Extension | Behavior |
| --- | --- |
| `dashboard/` | Responsive two-line footer with context pressure, accumulated session tokens and cost, model/thinking state, and Git/PR details; secondary session, provider, Git, and PR details progressively disappear at narrower widths. Installed-package statuses are excluded from the footer and presented as compact health rows in a non-capturing, fixed-width top-right overlay toggled by `/status-panel`. Git refreshes are watched/debounced with a 30s fallback; `/pr` forces an immediate refresh. |
| `autocomplete-above/` | Renders the prompt as a rounded accent-blue surface and joins slash-command or `@` file autocomplete to it above a shared divider, keeping the prompt anchored in fullscreen mode. |
| `background-terminals/` | Managed long-running processes through `bg_start`, `bg_status`, `bg_list`, and `bg_kill`; transcript rows use the shared muted two-line tool summary. `/ps` keeps its dedicated rounded terminal inspector. |
| `ask-user/` | `ask_user` tool for one focused 2–5 choice question, using the shared compact transcript summary plus rounded selector and free-form answer overlays. |
| `tool-inspector/` | Re-renders Pi's built-in tools as fixed two-line muted summaries with semantic status symbols and no transcript output. `/tools` opens a current-branch selector, then a scrollable overlay containing the complete arguments, output, details, usage, status, and timing. Runtime tool data and model context remain unchanged; Pi's normal expand key remains available for package-owned renderers. |
| `stream-ui/` | Shows a restrained Carbonfox pulse and `Working` label while partial assistant prose stays hidden; each finalized assistant message then appears atomically through Pi's Markdown renderer with response-only H1–H6 colors (pink, magenta, blue, cyan, teal, muted). H3–H6 flatten to display-only H2 markers so Pi does not print their hashes; original stored Markdown remains unchanged. User Markdown and the global `mdHeading` theme remain unchanged. Finalized assistant fences normalize common language aliases (`ts`, `js`, `py`, `sh`, and related forms), while `markdown.codeBlockIndent` adds a thin `│` rail without changing stored code. Hidden thinking uses `Reasoning…`. When the response fully settles, a persistent TUI-only summary such as `✓ Responded in 12.4s · 1.2k tokens · 84 tok/s` records elapsed time, assistant output tokens for that response, and generation throughput. |
| `copy-all/` | `/copy-all` copies user and assistant text from the active conversation branch. |
| `dump-system-prompt/` | `/dump-system-prompt` displays the current effective system prompt. |

Shared rounded-surface framing, terminal-native base backgrounds, selected-row
fills, and extension-owned dialog behavior live in `extensions/shared/ui.ts`.
Reusable fixed-height tool-call/result rendering lives in
`extensions/shared/tool-render.ts`; full tool payloads stay available through the
Tool Inspector instead of expanding inline. Using the terminal background for
framed surfaces avoids seams around box-drawing cells; Carbonfox keeps tool text
and shells uniformly muted while reserving success/error colors for status
symbols. Extension
runtime imports are supplied by Pi;
`extensions/package-lock.json` exists only to make local type-checking and tests
reproducible.

Third-party tools use their package-owned renderers because current Pi does not
provide a global render-only decorator. The tracked preferences choose the
closest supported compact modes without replacing package execution:

- MCP uses compact self-rendered results with one collapsed result line.
- Pi Lens collapses call and result rows into one summary line.
- Subagents use a stable one-line inline summary; FleetView retains live details.
- Intercom and Hermes Memory already provide compact package-owned summaries.
- Web access, FFF, and workflows retain richer semantic output where no supported
  global compact override exists.

Development:

```bash
npm --prefix extensions ci --ignore-scripts
just check    # tsc --noEmit + node --test
```

## Dependencies

Copying this config is **not** enough on its own. Some features need system
binaries or secrets:

| Dependency | Needed for | How it's resolved |
| --- | --- | --- |
| **Node.js + npm/npx** | Pi itself; installing `packages`; running local MCP servers | system install |
| **Pi CLI** | Coding-agent runtime | `tools/install-pi.sh` in my dotfiles repo (tracks the latest release), or install `@earendil-works/pi-coding-agent` directly |
| **`just`, `git`** | activating this config (symlinks) and dashboard repository status | system install |
| **GitHub CLI (`gh`)** | dashboard pull-request status and `/pr` | system install; the dashboard otherwise continues with local Git status only |
| **Language servers** (pyright, typescript-language-server, rust-analyzer, gopls, …) | `pi-lens` LSP nav/diagnostics | install per-language as needed; pi-lens uses whatever is on `PATH`. ast-grep is bundled (no install) |
| **Playwright CLI + Chromium** | Shared browser automation skill | see `agent-skills` in my dotfiles repo |
| **Provider credentials** | model access (Anthropic / OpenAI / Google) | `~/.pi/agent/auth.json` (run pi and log in; not tracked) |
| **Exa API key** | `pi-web-access` web search | `~/.pi/web-search.json` (not tracked) |
| **Network** | hosted Context7, first-run local MCP fetches, package installs, web search | — |

Self-contained (no extra setup): `pi-subagents`, `pi-intercom`, `pi-web-access`
fetch, pi-lens's bundled ast-grep, and the tracked custom extensions.

## Maintenance

**Package versions intentionally track latest.** The `packages` array in
`settings.json` lists bare specs (`npm:pi-lens`, no `@version`), so pi installs
the newest published version into `npm/node_modules` on each resolve. This is a
deliberate convenience choice for packages I actively use and trust enough to
track latest. For tighter supply-chain or reproducibility needs — especially for
third-party/community packages — add `@x.y.z` to a spec (e.g.
`npm:pi-lens@1.2.3`).

Context7 uses its hosted MCP endpoint, so there is no local Context7 package
version to bump. Portable skills, including browser automation, Cloudflare
tooling, and Railway, come from the shared `~/.agents/skills/` tree rather than
being copied into Pi.

Inspect current live disk use instead of documenting a value that changes with
package releases:

```bash
du -sh ~/.pi ~/.pi/agent/npm
```
