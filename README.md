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
| `AGENTS.md` — global agent instructions; `AGENTS.override.md` — project-only additions that prevent this repo from loading the global instructions twice | `auth.json` — credentials |
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
just doctor   # status + Pi runtime/development dependency compatibility
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
| `background-terminals/` | Managed long-running processes through `bg_start`, `bg_status`, `bg_list`, and `bg_kill`; tool calls and results use Pi's native rendering. `/ps` uses Pi's native selector and editor dialogs for inspection. |
| `copy-all/` | `/copy-all` copies user and assistant text from the active conversation branch. |
| `system-prompt-inspector/` | `/dump-system-prompt` opens the current effective system prompt in Pi's native editor dialog. |

Repository-owned extensions do not replace Pi's editor, autocomplete, footer,
status placement, working indicator, assistant Markdown, or transcript rendering.
The remaining UI interactions are inventoried in `extensions/UI-SURFACES.md`.
Extension runtime imports are supplied by Pi; `extensions/package-lock.json`
exists only to make local type-checking and tests reproducible.

Third-party tools use their package-owned renderers. The tracked preferences
choose supported compact modes without replacing package execution:

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
| **`just`, `git`** | activating this config and working with the repository | system install |
| **Language servers** (pyright, typescript-language-server, rust-analyzer, gopls, …) | `pi-lens` LSP nav/diagnostics | install per-language as needed; pi-lens uses whatever is on `PATH`. ast-grep is bundled (no install) |
| **Playwright CLI + Chromium** | Shared browser automation skill | see `agent-skills` in my dotfiles repo |
| **Provider credentials** | model access (Anthropic / OpenAI / Google) | `~/.pi/agent/auth.json` (run pi and log in; not tracked) |
| **Exa API key** | `pi-web-access` web search | `~/.pi/web-search.json` (not tracked) |
| **Network** | hosted Context7, first-run local MCP fetches, package installs, web search | — |

Self-contained (no extra setup): `pi-subagents`, `pi-intercom`, `pi-web-access`
fetch, pi-lens's bundled ast-grep, and the tracked custom extensions.

## Maintenance

### Extension ownership and Pi upgrades

Repository-owned extensions intentionally leave Pi's global editor, footer,
status placement, working indicator, Markdown, and transcript rendering native.
New global UI replacements should be treated as explicit ownership decisions and
recorded in `extensions/UI-SURFACES.md`. After upgrading Pi or installed packages:

1. Run `just doctor`. If it reports drift, update the three
   `@earendil-works/pi-*` development dependencies and refresh
   `extensions/package-lock.json` and `extensions/node_modules/`.
2. Run `just check`.
3. In a TUI session, verify native prompt/autocomplete, footer/status placement,
   streaming, built-in/background-terminal tool expansion, `/ps`, and
   `/dump-system-prompt`.

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
