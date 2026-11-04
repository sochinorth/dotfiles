# bun's globals (pi). pi runs node, npm and npx, and there's no Node here:
# ~/.local/pi-shims holds bun under those names (dev/post-dotfiles.sh), on PATH
# for pi alone.
path+=("$HOME/.bun/bin")
alias pi='PATH="$HOME/.local/pi-shims:$PATH" pi'

# `opencode pair` links to the web-gui proxy (dev/opencode/plugins/web-gui:
# OpenCode Web with GUI plugins) instead of the server itself, unless given
# its own --url or --remote.
opencode() {
	if [[ $1 == pair && " ${*:2} " != *" --url"* && " ${*:2} " != *" --remote "* ]]; then
		command opencode pair --url http://127.0.0.1:49380 "${@:2}"
	else
		command opencode "$@"
	fi
}

# direnv: per-directory environments from .envrc (`direnv allow` each one first)
eval "$(direnv hook zsh)"
