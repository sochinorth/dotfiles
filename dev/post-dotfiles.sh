#!/usr/bin/env bash
# The dev module's half of the post-dotfiles hook (mise.dev.toml; runs after
# scripts/post-dotfiles.sh): pi and its shims, the plugins' GUI builds, linger
# for the user units, and kak-tree-sitter's grammars.
set -euo pipefail

# pi (pi.dev's coding agent) is a bun global. It runs node, npm and npx, which
# this machine doesn't have: ~/.local/pi-shims holds bun under those names, and
# dev.zsh's pi alias puts it first on PATH for pi alone. `bun update -g` updates it.
[[ -x ~/.bun/bin/pi ]] || bun add -g @earendil-works/pi-coding-agent
mkdir -p ~/.local/pi-shims
for f in node npm npx; do ln -sfn /usr/bin/bun ~/.local/pi-shims/$f; done

# The plugins' GUI parts (tool-descriptions, follow-tools) are built into each
# plugin's dist/, not tracked, by opencode/build, which keeps the build's
# node_modules out of the plugins' watched directories. After editing a
# plugin's gui/, rerun this line.
(cd "$(dirname "$0")/opencode/build" && bun install --frozen-lockfile && bun run build)

# The user units (mise.dev.toml: OpenCode's server and web GUI proxy,
# dropbear) have to run from boot and outlive logins, which is linger. Root,
# once.
[[ -e /var/lib/systemd/linger/$USER ]] || sudo loginctl enable-linger "$USER"

# Skills picked from upstream: cloned if missing, patched, linked. Never pulls;
# that's skup, by hand. Non-fatal: it fetches.
"$(dirname "$0")/skills/skup" sync \
	|| echo "post-dotfiles: skup sync failed; rerun it, or the bootstrap, later" >&2

# kak-tree-sitter's grammars and queries for these languages (fetched and
# compiled; a no-op for those already at their pinned version). Languages
# without one keep Kakoune's own highlighting (kakrc sees to that). More:
# `ktsctl sync <lang>`, names from `ktsctl query -a`. Last and non-fatal: it
# fetches, and needs the user's runtime dir.
ktsctl sync c cpp rust rust-format-args python bash markdown markdown.inline toml json yaml \
	|| echo "post-dotfiles: ktsctl sync failed; rerun it, or the bootstrap, later" >&2
