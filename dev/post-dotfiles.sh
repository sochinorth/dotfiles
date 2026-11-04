#!/usr/bin/env bash
# The dev module's half of the post-dotfiles hook (mise.dev.toml; runs after
# scripts/post-dotfiles.sh): pi and its shims, the tool-descriptions plugin's
# build, linger for the dropbear user unit, and kak-tree-sitter's grammars.
set -euo pipefail

# pi (pi.dev's coding agent) is a bun global. It runs node, npm and npx, which
# this machine doesn't have: ~/.local/pi-shims holds bun under those names, and
# dev.zsh's pi alias puts it first on PATH for pi alone. `bun update -g` updates it.
[[ -x ~/.bun/bin/pi ]] || bun add -g @earendil-works/pi-coding-agent
mkdir -p ~/.local/pi-shims
for f in node npm npx; do ln -sfn /usr/bin/bun ~/.local/pi-shims/$f; done

# tool-descriptions' GUI part is built into the plugin's dist/, not tracked, by
# opencode/build, which keeps the build's node_modules out of the plugin's
# watched directory. After editing the plugin's gui/, rerun this line.
(cd "$(dirname "$0")/opencode/build" && bun install --frozen-lockfile && bun run build)

# The dropbear user unit (mise.dev.toml) has to outlive logins, which is linger.
# Root, once.
[[ -e /var/lib/systemd/linger/$USER ]] || sudo loginctl enable-linger "$USER"

# kak-tree-sitter's grammars and queries for these languages (fetched and
# compiled; a no-op for those already at their pinned version). Languages
# without one keep Kakoune's own highlighting (kakrc sees to that). More:
# `ktsctl sync <lang>`, names from `ktsctl query -a`. Last and non-fatal: it
# fetches, and needs the user's runtime dir.
ktsctl sync c cpp rust rust-format-args python bash markdown markdown.inline toml json yaml \
	|| echo "post-dotfiles: ktsctl sync failed; rerun it, or the bootstrap, later" >&2
