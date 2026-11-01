#!/usr/bin/env bash
# The dev module's half of the post-dotfiles hook (mise.dev.toml; runs after
# post-dotfiles.sh): kak-tree-sitter's grammars, pi and its shims, and linger
# for the dropbear user unit.
set -euo pipefail

# kak-tree-sitter's grammars and queries for these languages (fetched and
# compiled; a no-op for those already at their pinned version). Languages
# without one keep Kakoune's own highlighting (kakrc sees to that). More:
# `ktsctl sync <lang>`, names from `ktsctl query -a`.
ktsctl sync c cpp rust rust-format-args python bash markdown markdown.inline toml json yaml

# pi (pi.dev's coding agent) is a bun global. It runs node, npm and npx, which
# this machine doesn't have: ~/.local/pi-shims holds bun under those names, and
# .zshrc's pi alias puts it first on PATH for pi alone. `bun update -g` updates it.
[[ -x ~/.bun/bin/pi ]] || bun add -g @earendil-works/pi-coding-agent
mkdir -p ~/.local/pi-shims
for f in node npm npx; do ln -sfn /usr/bin/bun ~/.local/pi-shims/$f; done

# The dropbear user unit (mise.dev.toml) has to outlive logins, which is linger.
# Root, once.
[[ -e /var/lib/systemd/linger/$USER ]] || sudo loginctl enable-linger "$USER"
