#!/usr/bin/env bash
# post-dotfiles hook: state that apps generate on first run but .zshrc expects,
# the links Claude Code's config dirs need, and fortune's indexes.
set -euo pipefail

# .zshrc sources the bash `br` launcher at a fixed path; `broot --install` would
# also append its own source line to the rc files, so write it directly instead.
br=~/.config/broot/launcher/bash/br
if [[ ! -e $br ]]; then
	mkdir -p "${br%/*}"
	broot --print-shell-function bash >"$br"
	broot --set-install-state installed
fi

# tealdeer never fetches its page cache on its own.
[[ -d ~/.cache/tealdeer ]] || tldr --update

# kak-tree-sitter's grammars and queries for these languages (fetched and
# compiled; a no-op for those already at their pinned version). Languages
# without one keep Kakoune's own highlighting (kakrc sees to that). More:
# `ktsctl sync <lang>`, names from `ktsctl query -a`.
ktsctl sync c cpp rust rust-format-args python bash markdown markdown.inline toml json yaml

# Claude Code's managed settings (what claude and claude-go share; see mise.toml):
# /etc/claude-code is a link to dotfiles/claude/etc, so editing or adding
# files there (managed-settings.json, CLAUDE.md, managed-mcp.json) needs no
# bootstrap. /etc wants root, once: only a missing or wrong link is replaced,
# and a directory there only if it holds nothing but an old drop-in link.
etc=/etc/claude-code
src=$(cd -- "$(dirname -- "$0")/.." && pwd)/dotfiles/claude/etc
old=$etc/managed-settings.d/dotfiles.json
if [[ $(readlink "$etc" 2>/dev/null) == "$src" ]]; then
	:
elif [[ -d $etc && ! -L $etc && -n $(find "$etc" -mindepth 1 ! -path "$etc/managed-settings.d" ! -path "$old") ]]; then
	echo "warning: $etc has files of its own, so it isn't linked to $src" >&2
else
	sudo rm -rf -- "$etc"
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

# fortune needs an index (.dat, from strfile) beside each cookie file mise
# links into ~/.local/share/fortune; rebuilt when the file is newer. Links to
# files that left the repo go, and so do indexes without a file.
shopt -s nullglob
for f in ~/.local/share/fortune/*; do
	if [[ -L $f && ! -e $f ]]; then
		rm -- "$f"
	elif [[ $f == *.dat ]]; then
		[[ -e ${f%.dat} ]] || rm -- "$f"
	elif [[ ! $f.dat -nt $f ]]; then
		strfile -s "$f" "$f.dat"
	fi
done
