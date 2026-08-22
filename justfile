# Deploys this repo into ~/.pi/agent/ as symlinks. Top-level entries are linked
# individually (never ~/.pi/agent itself) because pi keeps runtime state and
# secrets (auth.json, sessions/, npm/, ...) in the same directory.

repo := justfile_directory()
agent_dir := env_var('HOME') / ".pi/agent"

# Symlinked into ~/.pi/agent/. Directories are linked whole, so files added to
# them later appear live without re-running `just apply`.
entries := "AGENTS.md settings.json mcp.json extensions skills prompts themes"

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

# Show what is linked, missing, or shadowed
status:
    #!/usr/bin/env bash
    set -uo pipefail
    for entry in {{ entries }}; do
        tgt="{{ agent_dir }}/$entry"
        if [ -L "$tgt" ] && [[ "$(readlink "$tgt")" == "{{ repo }}"/* ]]; then
            echo "ok      $entry"
        elif [ -e "$tgt" ]; then
            echo "shadow  $entry ($tgt is not a link into this repo)"
        else
            echo "absent  $entry"
        fi
    done

# Type-check and test the extensions
check:
    npm --prefix {{ repo }}/extensions run check
    npm --prefix {{ repo }}/extensions test
