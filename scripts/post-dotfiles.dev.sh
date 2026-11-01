#!/usr/bin/env bash
# The dev module's half of the post-dotfiles hook (mise.dev.toml; runs after
# post-dotfiles.sh): kak-tree-sitter's grammars, the links Claude Code's config
# dirs need, pi and its shims, and linger for the dropbear user unit.
set -euo pipefail

# kak-tree-sitter's grammars and queries for these languages (fetched and
# compiled; a no-op for those already at their pinned version). Languages
# without one keep Kakoune's own highlighting (kakrc sees to that). More:
# `ktsctl sync <lang>`, names from `ktsctl query -a`.
ktsctl sync c cpp rust rust-format-args python bash markdown markdown.inline toml json yaml

# Claude Code's managed settings (what claude and claude-go share; see mise.dev.toml):
# /etc/claude-code is a link to dotfiles/claude/etc, so editing or adding
# files there (managed-settings.json, CLAUDE.md, managed-mcp.json) needs no
# bootstrap. /etc wants root, once: a missing or wrong link is replaced, a real
# directory there is left alone.
etc=/etc/claude-code
src=$(cd -- "$(dirname -- "$0")/.." && pwd)/dotfiles/claude/etc
if [[ -d $etc && ! -L $etc ]]; then
	echo "warning: $etc is a directory, so it isn't linked to $src" >&2
elif [[ $(readlink "$etc") != "$src" ]]; then
	sudo ln -sfn "$src" "$etc"
fi

# ~/.claude.go (claude-go in .zshrc) is Claude Code on OpenCode Go. It keeps its
# own credentials, app state (.claude.json), settings.json (what /model, /theme
# and /config save; the shared settings are managed ones) and what mise links in
# (settings.go.json: theme and upstream); everything else is ~/.claude's. A real
# file or directory where a link belongs is left for you to merge into ~/.claude.
for f in CLAUDE.md keybindings.json history.jsonl \
	projects skills agents commands hooks rules output-styles workflows plugins plans themes; do
	src=~/.claude/$f dst=~/.claude.go/$f
	[[ $f == *.* ]] || mkdir -p "$src"
	if [[ -L $dst || ! -e $dst ]]; then
		ln -sfn "$src" "$dst"
	else
		echo "post-dotfiles: $dst should link to $src; merge it there and remove it" >&2
	fi
done

# pi (pi.dev's coding agent) is a bun global. It runs node, npm and npx, which
# this machine doesn't have: ~/.local/pi-shims holds bun under those names, and
# .zshrc's pi alias puts it first on PATH for pi alone. `bun update -g` updates it.
[[ -x ~/.bun/bin/pi ]] || bun add -g @earendil-works/pi-coding-agent
mkdir -p ~/.local/pi-shims
for f in node npm npx; do ln -sfn /usr/bin/bun ~/.local/pi-shims/$f; done

# The dropbear user unit (mise.dev.toml) has to outlive logins, which is linger.
# Root, once.
[[ -e /var/lib/systemd/linger/$USER ]] || sudo loginctl enable-linger "$USER"
