# pi-config

Global config for the [Pi coding agent](https://github.com/badlogic/pi-mono),
deployed into `~/.pi/agent/` (plus the Pi Lens config path) as symlinks. Formerly the `pi` package of my
dotfiles repo; split out because the custom extensions have grown into a real
TypeScript project.

User-authored config is tracked here, with one explicit exception: the
Herdr-managed integration at `extensions/herdr-agent-state.ts`. Secrets and
runtime state stay in the live `~/.pi/` dir, which this repo never owns wholesale —
each top-level entry is linked individually so Pi's runtime files remain ordinary
local files beside the links.

| Tracked | Tool-managed / secret (stays in `~/.pi/`, NOT tracked) |
| --- | --- |
| `AGENTS.md` — global agent instructions; `AGENTS.override.md` — project-only additions that prevent this repo from loading the global instructions twice | `auth.json` — credentials |
| `settings.json` — provider/model defaults, scoped model cycling, installed `packages` | `npm/`, `git/` — Pi's package installations, regenerated from `settings.json` |
| `keybindings.json` — user keybinding overrides (currently none) | — |
| `mcp.json` — hosted Context7 and AWS MCP (via local proxy), plus compact MCP result rendering | `sessions/`, `mcp-cache.json`, `models-store.json`, `run-history.jsonl`, `intercom/`, `trust.json` — runtime state |
| `pi-lens.json` — tracked Pi Lens preferences, linked to `~/.pi-lens/config.json` | the rest of `~/.pi-lens/` — logs, caches, downloaded binaries, and other extension state |
| `extensions/` — custom TS extensions, Herdr integration, subagent display preferences, and development lockfile | `fff/`, `pi-hermes-memory/`, `projects-memory/`, `missions/`, `tmp/` — extension state |
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
just doctor   # links, JSON, executables, and runtime/development compatibility
just unlink   # remove the symlinks (only ones pointing into this repo)
```

Directories (`extensions/`, `skills/`, `prompts/`, `themes/`) are linked whole,
so new files created in the repo — or from the live side under
`~/.pi/agent/extensions/` etc. — appear in both places immediately. `pi-lens.json`
is linked separately to `~/.pi-lens/config.json`; Pi Lens keeps its generated
state beside that link. Anything pi-side tools drop into the linked directories
lands in the repo working tree; `.gitignore` is the filter. Background-task
artifacts under `.pi/tasks/` and common local credential files are ignored;
project `.pi/` configuration and `.env.example` files remain trackable. Ignore
rules are a safety net, not secret scanning: review changes before committing.

Fresh-machine order: install Node 24 + git + just → install the Pi CLI → clone
this repo → `just apply` → run Pi (it installs the tracked `packages` and
prompts for provider login) → add optional external dependencies as needed
(language servers, Chromium, Exa key).

## Custom extensions

| Extension | Behavior |
| --- | --- |
| `copy-all/` | `/copy-all` copies user and assistant text from the active conversation branch. |
| `system-prompt-inspector/` | `/dump-system-prompt` opens the current effective system prompt in Pi's native editor dialog. |

`extensions/herdr-agent-state.ts` is **managed by Herdr**, not hand-maintained.
It reports session/activity state only inside a Herdr TUI pane. Herdr updates may
overwrite it through the directory symlink; review and commit those changes as
upstream integration updates. Do not edit it for custom behavior. Its
`@ts-nocheck` directive means the repository type check does not validate its
implementation; verify Herdr behavior manually after upgrades.

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
just setup    # install locked development dependencies; no live deployment
just check    # JSON validation + tsc --noEmit + extension/deployment tests
```

`just status` and `just doctor` return nonzero for deployment problems, including
broken links and links to the wrong file inside this repo. `doctor` also checks
`node`, `npm`, `git`, `pi`, configured local MCP launchers (currently `uvx`), and
the three Pi development dependency versions. It does not authenticate, connect
to MCP servers, or validate optional language/browser/audio tooling.

GitHub Actions runs `just setup` and `just check` on pushes and pull requests,
using Node 24. Deployment tests use temporary home directories, not live config.
CI needs no Pi login, AWS credentials, or globally installed Pi CLI.

## Installed package responsibilities

| Package | Responsibility |
| --- | --- |
| `pi-web-access` | Web search and content extraction |
| `pi-mcp-adapter` | On-demand MCP discovery and calls |
| `pi-lens` | Code intelligence, diagnostics, and structural checks |
| `@ff-labs/pi-fff` | Fast file/content search |
| `pi-subagents` | Delegated agents and supervised execution |
| `@quintinshaw/pi-dynamic-workflows` | Opt-in multi-agent workflows |
| `pi-background-tasks` | Background commands, read-only delegates, and Fusion tasks |
| `pi-intercom` | Coordination between running Pi sessions |
| `pi-hermes-memory` | Persistent memory and session search |
| `pi-agent-browser-native` | Browser interaction and automation |
| `@juicesharp/rpiv-voice` | Local speech-to-text prompt dictation |
| `@juicesharp/rpiv-ask-user-question` | Structured user questions |
| `@juicesharp/rpiv-todo` | Task tracking |
| `ayghri/i-have-adhd` | Toggleable response-style guidance |

Delegation packages overlap in capability but serve different execution models.
They are intentionally retained; no package selection is changed by the
repository checks.

## Dependencies

Copying this config is **not** enough on its own. Some features need system
binaries or secrets:

| Dependency | Needed for | How it's resolved |
| --- | --- | --- |
| **Node.js 24 + npm/npx** | Pi itself, packages, TypeScript tests | system install; CI uses Node 24 |
| **Pi CLI** | Coding-agent runtime | `tools/install-pi.sh` in my dotfiles repo (tracks the latest release), or install `@earendil-works/pi-coding-agent` directly |
| **`just`, `git`** | activating this config and working with the repository | system install |
| **Language servers** (pyright, typescript-language-server, rust-analyzer, gopls, …) | `pi-lens` LSP nav/diagnostics | install per-language as needed; pi-lens uses whatever is on `PATH`. ast-grep is bundled (no install) |
| **Playwright CLI + Chromium** | Shared browser automation skill | see `agent-skills` in my dotfiles repo |
| **Provider credentials** | model access (Anthropic / OpenAI / Google) | `~/.pi/agent/auth.json` (run pi and log in; not tracked) |
| **Search provider credentials** | `pi-web-access` web search, depending on provider | `~/.pi/web-search.json` / provider authentication (not tracked) |
| **`CONTEXT7_API_KEY`** | Hosted Context7 authentication | exported environment variable referenced by `mcp.json`; never put the value in this repo |
| **`uv` / `uvx`** | Launching `mcp-proxy-for-aws@latest` | install [uv](https://docs.astral.sh/uv/getting-started/installation/); `uvx` resolves the proxy on demand |
| **AWS credentials, CLI, and permissions** | AWS MCP access and local credential management | working `default` AWS profile; see below |
| **Browser/audio dependencies** | Browser automation and voice dictation | follow each package's setup; voice downloads a local speech model on first use |
| **Network** | Context7, AWS MCP, first-run proxy/model fetches, package installs, web search | — |

Self-contained (no extra setup): `pi-subagents`, `pi-intercom`, `pi-web-access`
fetch, pi-lens's bundled ast-grep, and the two custom command extensions.

### AWS MCP setup

The AWS server in `mcp.json` launches `uvx mcp-proxy-for-aws@latest` against
`https://aws-mcp.us-east-1.api.aws/mcp`. Both MCP servers are lazy: opening Pi
does not itself connect them.

- Install `uv` (provides `uvx`) and AWS CLI v2 for local authentication management.
- Provide valid short-lived credentials for the `default` profile using your
  existing AWS login or IAM Identity Center workflow. The proxy is explicitly
  configured with `AWS_MCP_PROXY_PROFILES=default`; changing only `AWS_PROFILE`
  is not a replacement for updating that setting.
- The profile's identity needs permission to use AWS MCP and any underlying AWS
  operations it invokes. Prefer least-privilege access, especially for mutations.
- Keep AWS config/credentials and cached login tokens under `~/.aws/`, outside
  this repository. Validate authentication and MCP connectivity separately when
  using AWS tools; `just doctor` deliberately performs no cloud calls.

## Maintenance

### Extension ownership and Pi upgrades

Repository-owned extensions intentionally leave Pi's global editor, footer,
status placement, working indicator, Markdown, and transcript rendering native.
New global UI replacements should be treated as explicit ownership decisions and
recorded in `extensions/UI-SURFACES.md`. After upgrading Pi or installed packages:

1. Run `just doctor`. If it reports drift, update the three
   `@earendil-works/pi-*` development dependencies to the exact installed Pi
   version and refresh `extensions/package-lock.json` and
   `extensions/node_modules/`. Exact development pins do not pin the runtime
   feature packages in `settings.json`.
2. Run `just check`.
3. In a TUI session, verify native prompt/autocomplete, footer/status placement,
   streaming, built-in tool expansion, `/copy-all`, and `/dump-system-prompt`.

**Package versions intentionally track latest.** The `packages` array in
`settings.json` lists bare specs (`npm:pi-lens`, no `@version`), so pi installs
current releases when installing missing packages or explicitly updating them
with `pi update --extensions`; an existing install is not upgraded on every launch. This is a
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
