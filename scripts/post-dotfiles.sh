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

# Agent skills (submodules in dotfiles/skills), one link per skill: in
# ~/.agents/skills, which OpenCode and other agent tools read, and in
# ~/.claude/skills for Claude Code. A skill's directory must be named after
# it (its SKILL.md's name:). Links into here that lead nowhere any more go.
here=$(cd -- "$(dirname -- "$0")/.." && pwd)
for dir in ~/.agents/skills ~/.claude/skills; do
	mkdir -p "$dir"
	for skill in "$here"/dotfiles/skills/*/plugins/*/skills/*/; do
		[[ -e $skill/SKILL.md ]] || continue
		skill=${skill%/}
		ln -sfn "$skill" "$dir/${skill##*/}"
	done
	for link in "$dir"/*; do
		if [[ -L $link && ! -e $link && $(readlink "$link") == "$here"/dotfiles/skills/* ]]; then
			rm -- "$link"
		fi
	done
done
