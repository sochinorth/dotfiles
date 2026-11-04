# setup

Arch (CachyOS repos), reproducible with `mise bootstrap` (mise ≥ 2026.9).

## Layout

| File | What it is | Sources |
| --- | --- | --- |
| `mise.toml` | Generic, for any machine (servers, routers too): repos, doas/fudo, shell, CLI, Kakoune, `/etc` basics, dotfiles | `files/`, `dotfiles/`, `scripts/` |
| `mise.dev.toml` | Dev module: toolchains (clang, cmake, mingw-w64, bun, pip), debuggers, gh, direnv, just, kakoune-lsp + kak-tree-sitter; coding agents: OpenCode and pi with their config, Claude Code as a runtime for OpenCode (no config); dropbear on :22222 as a user unit (SSH in without root) | `dev/` |
| `mise.wsl.toml` | WSL module: `wsl.conf`, xclip → win32yank shim, the stock /tmp cleaner unmasked (WSLg's X socket exempt), `.wslconfig`, Windows PATH, win32yank (AUR), the Npcap loopback keepalive (a Windows scheduled task, for mirrored loopback) | `wsl/` |
| `.miserc.local.toml` | Per machine, gitignored: which modules a plain `mise bootstrap` loads | |
| `dotfiles/config/kak` | Kakoune: kakrc, kakbr, `kakmux`/`kakbr-sidebar`/`broot-open`, `kak()`/`kakbr()`; the [kakmux](https://github.com/sochinorth/kakmux) repo as a submodule, with its own tests | mise links each file (`[dotfiles]`) |
| `dev/opencode` | OpenCode (v2): the global `opencode.json`, `cli.json` (the TUI's: theme), `plugins/codex-sale` (live models with catalog capabilities and limits), and `plugins/claude-entrypoint` (Claude launch environment) | mise links `opencode.json` and the plugins into `~/.config/opencode`, seeds `cli.json` |
| `dev/agents/AGENTS.md` | Global instructions for the coding agents: workflow state (plans, logs, test manifests, ledgers) goes in a `.wip/` that `dotfiles/config/git/ignore` ignores everywhere, never in `docs/` or other tracked files | mise links it as `~/.config/opencode/AGENTS.md` and `~/.pi/agent/AGENTS.md` |
| `dev/skills/idasql` | [idasql-skills](https://github.com/allthingsida/idasql-skills), pinned as a submodule (skills and their references, unchanged upstream) | mise links each skill into `~/.config/opencode/skills/idasql-*`, giving it an IDASQL-prefixed ID |
| `dotfiles/fortune` | fortune cookies fortune-mod doesn't ship: its offensive (`-off`) set, which Arch builds without, and others (sources below) | mise links each into `~/.local/share/fortune`; `post-dotfiles` runs `strfile` |
| `README.local.md` | Per machine, gitignored: notes about this machine (what isn't captured, where) | |

```sh
mise bootstrap                 # generic + modules from .miserc.local.toml
mise -E wsl bootstrap          # generic + WSL, explicitly
mise -E dev,wsl bootstrap      # generic + dev + WSL (this dev box)
MISE_ENV=none mise bootstrap   # generic only, overriding .miserc.local.toml
mise bootstrap unapply wsl     # remove what the WSL module manages
mise bootstrap unapply dev     # turn a dev box back into a generic one
```

Each module keeps what it brings in its own directory (`wsl/`, `dev/`), so `dotfiles/`,
`files/` and `scripts/` are only the generic part's. What a module adds to `.zshrc` goes in
`~/.config/zsh/conf.d/*.zsh`, which `.zshrc` sources: each deploys its own drop-in
(`wsl/zsh/wsl.zsh`: Windows PATH; `dev/zsh/dev.zsh`: bun's globals, pi, the direnv hook).

**Adding another platform** (e.g. bare metal): create `mise.baremetal.toml` with
its sources in `baremetal/`, and select it with `-E baremetal` or in that machine's
`.miserc.local.toml`. Generic parts that are still machine-specific (the znver4 repos
in `files/etc/pacman.conf` and the Zen 4 check in `scripts/pre-packages.sh`) would
move into modules too, if the new machine has a different CPU.

## Fresh machine

```sh
# 1. as root, once (creates the user, wheel, doas.conf; plus wsl.conf under WSL)
pacman -Sy --noconfirm git && git clone <this repo> /tmp/setup && /tmp/setup/install-root.sh

# 2. WSL only: from Windows
wsl --terminate archlinux

# 3. as your user
git clone --recurse-submodules <this repo> ~/setup && cd ~/setup
mise trust && mise -E dev,wsl bootstrap --dry-run && mise -E dev,wsl bootstrap   # drop dev on a server/router, wsl on bare metal
```

Then copy `~/.ssh/id_ed25519_*` over by hand (keys are deliberately not in the repo). Hosts that only matter on one machine go in `~/.ssh/config.local`, which `~/.ssh/config` includes.

With dev, sign the coding agents in again: credentials stay out of the repo. Claude Code: sign in once with `claude`, for OpenCode's Claude Agent provider. OpenCode: `/connect` each provider (codex.sale, OpenRouter, DeepSeek, ...). pi: its own sign-in (it keeps it in `~/.pi/agent/auth.json`).

The Kakoune config (`dotfiles/config/kak`) and IDASQL skills (`dev/skills/idasql`)
are submodules, cloned over HTTPS (no keys needed yet). A clone made without
`--recurse-submodules` gets them from the `pre-dotfiles` hook; by hand,
`git submodule update --init`. After pulling a commit that moves one,
`git submodule update` (that checks out the recorded commit: commit and push
work in the submodule first).

IDASQL skills are loaded by OpenCode itself, not through Claude Code's plugin
marketplace. Start with `@idasql-connect`; all 16 skill IDs are prefixed
(`idasql-analysis`, `idasql-decompiler`, `idasql-xrefs`, etc.). OpenCode derives
IDs from each linked directory's basename; a parent grouping directory would
not namespace them. Display names and cross-skill names in the upstream text
remain unchanged: for example, its `connect` means `idasql-connect` here.
To update, run
`git -C dev/skills/idasql pull --ff-only` and record the new submodule commit.

## Order of operations, and why

mise runs as your user and elevates with `sudo`. On this setup `sudo` is
**fudo-git**, a shim that turns sudo calls into **doas** (`permit persist keepenv :wheel`).
That dependency chain fixes the order:

1. `install-root.sh` (root): user in `wheel`, `opendoas`, `/etc/doas.conf`. There is no sudo yet.
2. `pre-packages` hook (`scripts/pre-packages.sh`, through doas):
   - imports the CachyOS and Chaotic-AUR keys, installs the mirror lists and `pacman.conf`
   - installs the keyrings, then reinstalls everything from the znver4 repos (CachyOS's own procedure)
   - installs `paru` (prebuilt, cachyos repo), removes real sudo only after `doas true` succeeds, then `paru` installs fudo-git
3. `[bootstrap.packages]`: pacman, now through sudo → fudo → doas; `aur:` entries through paru, which uses the stock `/etc/paru.conf` and elevates through sudo → fudo → doas too. Don't create an empty `~/.config/paru/paru.conf`: any user file replaces `/etc/paru.conf` and loses its defaults.
4. `[bootstrap.files]`: `/etc` configs; with WSL, also the `/usr/local/bin/xclip` → `win32yank.exe` shim.
5. The `pre-dotfiles` hook (checks out missing submodules), `[dotfiles]`, then the `post-dotfiles` hooks: `scripts/post-dotfiles.sh` (broot `br` launcher, tealdeer cache, fortune indexes), then with dev `dev/post-dotfiles.sh` (pi and its shims, linger for the dropbear unit, kak-tree-sitter grammars). Hooks from each file add up; a module's hook doesn't replace the generic one.
6. With dev, the dropbear user unit (`dev.mise.dropbear.service`, enabled and started); then login shell → zsh; with WSL, the `final` hook writes `.wslconfig` on the Windows side.

## Gotchas captured here

- **Never install `base-devel`**: it depends on `sudo`, which conflicts with fudo-git.
- The **znver4 repos** need a Zen 4+ CPU. The hook refuses to run on anything else.
- `makepkg.conf` (`-march=native -O3`, LTO) is not tracked: it ships that way in CachyOS's `pacman`.
- WSL: `appendWindowsPath = false` in `wsl.conf`. The WSL drop-in adds back only System32; `win32yank.exe` comes from the AUR (`win32yank-bin`) into `/usr/bin`, since a Windows exe runs from the WSL filesystem too. The Windows home isn't configured: the `final` hook asks PowerShell for `%USERPROFILE%`, in the same call as the RAM size.
- WSL: `.wslconfig` (mirrored networking; `memory=` 85% of the host's RAM, filled in then) is written to the Windows side by the `final` hook, not symlinked, and not a `[dotfiles]` entry (its path depends on the Windows user).
- Cookies in `dotfiles/fortune`, each as published (checked 2026-10-13, all at their latest): the `-off` files are [fortune-mod](https://github.com/shlomif/fortune-mod)'s `datfiles/off/unrotated`; `archlinux` from the AUR's fortune-mod-archlinux; `billwurtz` from [Ev1lbl0w/fortune-mod-billwurtz](https://github.com/Ev1lbl0w/fortune-mod-billwurtz); `g` is [ketogenesis/gfortune](https://github.com/ketogenesis/gfortune)'s `gsource`; `lambda` is [LAMBDA.TXT](http://www.gotlisp.com/lambda/lambda.txt) v11; `linuxorgru` is the lorquotes.ru dump (2021.07, via the AUR's fortune-mod-lorquotes; the site is gone). Plain `fortune` (stock build) shows the `-off` ones like any others.
- btop rewrites its own config, so that one is a copy. After changing settings in the app, run `mise dot add <path>`.
- broot opens files in Kakoune: Enter is a verb in `verbs.hjson`; double-click is hard-wired to the system opener, so `broot-open` is also installed as `wslview`/`xdg-open` in `~/.local/lib/broot-opener`, a dir only broot gets on PATH (`broot()` in kakmux's `shell/kakmux.zsh`, which `.zshrc` sources; `kakbr-sidebar`). In `kakbr`'s sidebar both go to kakbr's kak; elsewhere in tmux, to a kak pane in broot's window (kakrc labels each kak client's pane). `kakmux` and `kakbr` each run their own tmux server (`kakmux-PID`, `kakbr-PID`), so each is one pane in whatever runs it; kakbr's right pane is just a `kakmux`.
- kak-tree-sitter turns off Kakoune's own highlighting for every language it knows, grammar installed or not. So kakrc writes `~/.config/kak-tree-sitter/config.toml` (not tracked; regenerated when the installed set changes) to hand every language without a grammar back to Kakoune. The dev module's post-dotfiles hook installs a handful (C/C++, Rust, Python, Bash, Markdown, TOML, JSON, YAML); add more with `ktsctl sync <lang>`.
- Claude Code is only a runtime: OpenCode's Claude Agent provider starts `claude` with `--setting-sources=` (no settings files), `--tools=` (OpenCode's tools over MCP instead), and hooks, CLAUDE.md and auto memory off. Only managed settings (`/etc/claude-code`) would still reach it, so there are none.
- `plugins/claude-entrypoint` sets `CLAUDE_CODE_ENTRYPOINT=opencode` in the OpenCode server, so Claude Agent's SDK inherits it instead of defaulting to `sdk-ts`. Other server child processes inherit it too; standalone Claude is unchanged. Already-running Claude processes keep their original environment.
- OpenCode also discovers `~/.claude/skills` independently of the Claude Agent provider. `dev/opencode/opencode.json` blocks the eight Claude-synced skill IDs (`built-in-browser`, `chrome-browser`, `computer-use`, `docs`, `docx`, `pdf`, `pptx`, `xlsx`) with `skill.use` policies: they expect Claude-specific tools. Claude's files stay untouched. The rules match IDs, not source paths; newly synced IDs need their own rule.
- OpenCode runs as a background service that caches a plugin's module by path: after editing `plugins/codex-sale`, run `opencode service restart` (a config reload re-runs the old code). Its credentials, sessions and model picks are in its database, `~/.local/share/opencode`. It's the pacman package, so update it with pacman, not `opencode upgrade`.
- pi (`@earendil-works/pi-coding-agent`, a bun global) runs `node`/`npm`/`npx`, and there's no Node here: `~/.local/pi-shims` holds bun under those names, and the `pi` alias (`dev/zsh/dev.zsh`) puts it first on PATH for pi alone.
- Dropbear (dev) serves only you, since it runs as you, and keys only: the ones in `dev/ssh/authorized_keys`, copied (not linked) to `~/.ssh/authorized_keys`. Its host key is generated on the unit's first start in `~/.config/dropbear/`, so a new machine has a new one.
- Not captured: secrets (SSH keys, app credentials), project checkouts, timezone/hostname files that WSL generates. What that means on a given machine goes in its `README.local.md`.

## License

MIT, see [LICENSE](LICENSE), except `dotfiles/fortune/`: those cookies are their authors', as published by the sources listed above. The kak config (kakmux) is a submodule with its own license.
