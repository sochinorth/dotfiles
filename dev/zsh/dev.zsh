# bun's globals (pi). pi runs node, npm and npx, and there's no Node here:
# ~/.local/pi-shims holds bun under those names (dev/post-dotfiles.sh), on PATH
# for pi alone.
path+=("$HOME/.bun/bin")
alias pi='PATH="$HOME/.local/pi-shims:$PATH" pi'

# direnv: per-directory environments from .envrc (`direnv allow` each one first)
eval "$(direnv hook zsh)"

# Upstream changes to the agent skills we picked (dev/skills/skup), checked in the
# background at most daily.
_skup_check() {
	local stamp=~/.cache/skill-update-check out=~/.cache/skill-updates

	[[ -s $out ]] && print -P "%F{yellow}skill updates:%f $(<$out) %F{8}(run skup)%f"

	local -a recent=( ${~stamp}(N.mh-24) )
	(( $#recent )) && return

	{
		mkdir -p ${stamp:h} && touch $stamp
		local found=$(skup check 2>/dev/null)
		if [[ -n $found ]]; then print -r -- "$found" >| $out; else : >| $out; fi
	} &!
}
[[ -o interactive ]] && (( $+commands[skup] )) && _skup_check
