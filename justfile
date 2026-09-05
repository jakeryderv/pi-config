# Deploys this repo into ~/.pi/agent/ as symlinks. Top-level entries are linked
# individually (never ~/.pi/agent itself) because pi keeps runtime state and
# secrets (auth.json, sessions/, npm/, ...) in the same directory.

repo := justfile_directory()
agent_dir := env_var('HOME') / ".pi/agent"
lens_config := repo / "pi-lens.json"
lens_target := env_var('HOME') / ".pi-lens/config.json"

# Symlinked into ~/.pi/agent/. Directories are linked whole, so files added to
# them later appear live without re-running `just apply`.
entries := "AGENTS.md settings.json keybindings.json mcp.json extensions skills prompts themes"

default: status

# Link this repo's config into ~/.pi/agent/
apply:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{ agent_dir }}"
    for entry in {{ entries }}; do
        src="{{ repo }}/$entry" tgt="{{ agent_dir }}/$entry"
        if [ -e "$tgt" ] && [ ! -L "$tgt" ]; then
            echo "SKIP  $tgt exists and is not a symlink; move it aside first" >&2
            continue
        fi
        ln -sfn "$src" "$tgt"
        echo "link  $tgt -> $src"
    done
    mkdir -p "$(dirname "{{ lens_target }}")"
    if [ -e "{{ lens_target }}" ] && [ ! -L "{{ lens_target }}" ]; then
        echo "SKIP  {{ lens_target }} exists and is not a symlink; move it aside first" >&2
    else
        ln -sfn "{{ lens_config }}" "{{ lens_target }}"
        echo "link  {{ lens_target }} -> {{ lens_config }}"
    fi

# Remove the symlinks from ~/.pi/agent/ (only ones pointing into this repo)
unlink:
    #!/usr/bin/env bash
    set -euo pipefail
    for entry in {{ entries }}; do
        tgt="{{ agent_dir }}/$entry"
        if [ -L "$tgt" ] && [[ "$(readlink "$tgt")" == "{{ repo }}"/* ]]; then
            rm "$tgt"
            echo "rm    $tgt"
        fi
    done
    if [ -L "{{ lens_target }}" ] && [[ "$(readlink "{{ lens_target }}")" == "{{ lens_config }}" ]]; then
        rm "{{ lens_target }}"
        echo "rm    {{ lens_target }}"
    fi

# Show exact deployment links; fail for missing, broken, or incorrect links
status:
    #!/usr/bin/env bash
    set -uo pipefail
    mismatch=0
    check_link() {
        local label="$1" target="$2" expected="$3"
        if [ -L "$target" ] && [ ! -e "$target" ]; then
            echo "broken  $label ($target)"
        elif [ -L "$target" ] && [ "$(readlink "$target")" = "$expected" ]; then
            echo "ok      $label"
            return
        elif [ -e "$target" ]; then
            echo "shadow  $label (expected $target -> $expected)"
        else
            echo "absent  $label (expected at $target)"
        fi
        mismatch=1
    }
    for entry in {{ entries }}; do
        check_link "$entry" "{{ agent_dir }}/$entry" "{{ repo }}/$entry"
    done
    check_link "pi-lens.json" "{{ lens_target }}" "{{ lens_config }}"
    exit "$mismatch"

# Check deployment, JSON, executables, and development/runtime compatibility
doctor:
    #!/usr/bin/env bash
    set -euo pipefail
    mismatch=0
    just --justfile "{{ repo }}/justfile" status || mismatch=1
    for command in node npm git pi; do
        if command -v "$command" >/dev/null 2>&1; then
            echo "ok      executable $command"
        else
            echo "missing executable $command" >&2
            mismatch=1
        fi
    done
    # JSON checks need Node and git; stop here if either is unavailable.
    command -v node >/dev/null 2>&1 && command -v git >/dev/null 2>&1 || exit 1
    just --justfile "{{ repo }}/justfile" check-json || exit 1
    # Check configured local MCP launchers without starting servers or reading credentials.
    while IFS= read -r command; do
        if command -v "$command" >/dev/null 2>&1; then
            echo "ok      MCP executable $command"
        else
            echo "missing MCP executable $command (see README dependencies)" >&2
            mismatch=1
        fi
    done < <(node -e 'const c=require(process.argv[1]); for (const s of Object.values(c.mcpServers ?? {})) if (s.disabled !== true && typeof s.command === "string") console.log(s.command)' "{{ repo }}/mcp.json")
    command -v pi >/dev/null 2>&1 || exit 1
    runtime_version="$(pi --version)"
    for package in pi-ai pi-coding-agent pi-tui; do
        package_json="{{ repo }}/extensions/node_modules/@earendil-works/$package/package.json"
        if [ ! -f "$package_json" ]; then
            echo "missing @earendil-works/$package (run npm --prefix extensions ci --ignore-scripts)" >&2
            mismatch=1
            continue
        fi
        dev_version="$(node -e 'console.log(require(process.argv[1]).version)' "$package_json")"
        if [ "$dev_version" = "$runtime_version" ]; then
            echo "ok      @earendil-works/$package $dev_version"
        else
            echo "drift   @earendil-works/$package $dev_version (Pi runtime $runtime_version)" >&2
            mismatch=1
        fi
    done
    exit "$mismatch"

# Install locked development dependencies (does not deploy live config)
setup:
    npm --prefix "{{ repo }}/extensions" ci --ignore-scripts

# Validate tracked and new, non-ignored JSON files
check-json:
    node "{{ repo }}/scripts/check-json.mjs"

# Run extension and isolated deployment regression tests
test:
    npm --prefix "{{ repo }}/extensions" test
    node --test "{{ repo }}/scripts/config.test.mjs"

# Credential-free checks shared with CI
check: check-json
    npm --prefix "{{ repo }}/extensions" run check
    just --justfile "{{ repo }}/justfile" test
