# bun's globals (pi). pi runs node, npm and npx, and there's no Node here:
# ~/.local/pi-shims holds bun under those names (dev/post-dotfiles.sh), on PATH
# for pi alone.
path+=("$HOME/.bun/bin")
alias pi='PATH="$HOME/.local/pi-shims:$PATH" pi'

# direnv: per-directory environments from .envrc (`direnv allow` each one first)
eval "$(direnv hook zsh)"
