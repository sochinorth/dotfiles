#!/usr/bin/env bash
# post-dotfiles hook: state that apps generate on first run but .zshrc expects.
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

# Claude Code's managed settings (what claude and claude-go share; see mise.toml)
# are a link into this repo, so editing them needs no bootstrap. /etc wants root,
# once: only a missing or wrong link (or a file from before) is replaced.
managed=/etc/claude-code/managed-settings.d/dotfiles.json
src=$(cd -- "$(dirname -- "$0")/.." && pwd)/dotfiles/claude/managed-settings.json
if [[ $(readlink "$managed" 2>/dev/null) != "$src" ]]; then
	sudo install -d -m 755 "${managed%/*}"
	sudo ln -sfn "$src" "$managed"
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
