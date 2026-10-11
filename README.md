# setup

Arch (CachyOS repos), reproducible with `mise bootstrap` (mise ≥ 2026.9).

## Layout

| File | What it is | Sources |
| --- | --- | --- |
| `mise.toml` | Generic: repos, doas/fudo, packages, `/etc` basics, dotfiles | `files/`, `dotfiles/`, `scripts/` |
| `mise.wsl.toml` | WSL module: `wsl.conf`, xclip → win32yank shim, `.wslconfig`, Windows PATH, win32yank check | `wsl/` |
| `.miserc.local.toml` | Per machine, gitignored: which modules a plain `mise bootstrap` loads | |

```sh
mise bootstrap                 # generic + modules from .miserc.local.toml
mise -E wsl bootstrap          # generic + WSL, explicitly
MISE_ENV=none mise bootstrap   # generic only, overriding .miserc.local.toml
mise bootstrap unapply wsl     # remove what the WSL module manages
```

Platform tweaks that belong in `.zshrc` go in `~/.config/zsh/conf.d/*.zsh`, which
`.zshrc` sources. A module deploys its own drop-in (WSL: `wsl/zsh/wsl.zsh`).

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
git clone <this repo> ~/setup && cd ~/setup
mise trust && mise -E wsl bootstrap --dry-run && mise -E wsl bootstrap   # drop -E wsl on bare metal
```

Then copy `~/.ssh/id_ed25519_*` over by hand (keys are deliberately not in the repo).

## Order of operations, and why

mise runs as your user and elevates with `sudo`. On this setup `sudo` is
**fudo-git**, a shim that turns sudo calls into **doas** (`permit persist keepenv :wheel`).
That dependency chain fixes the order:

1. `install-root.sh` (root): user in `wheel`, `opendoas`, `/etc/doas.conf`. There is no sudo yet.
2. `pre-packages` hook (`scripts/pre-packages.sh`, through doas):
   - imports the CachyOS and Chaotic-AUR keys, seeds the mirrorlists, installs `pacman.conf`
   - installs the keyrings, then reinstalls everything from the znver4 repos (CachyOS's own procedure)
   - installs `paru` (prebuilt, cachyos repo), removes real sudo only after `doas true` succeeds, then `paru` installs fudo-git
3. `[bootstrap.packages]`: pacman, now through sudo → fudo → doas; `aur:` entries through paru, which uses the stock `/etc/paru.conf` and elevates through sudo → fudo → doas too. Don't create an empty `~/.config/paru/paru.conf`: any user file replaces `/etc/paru.conf` and loses its defaults.
4. `[bootstrap.files]`: `/etc` configs; with WSL, also the `/usr/local/bin/xclip` → `win32yank.exe` shim.
5. `[dotfiles]`, then the `post-dotfiles` hook (broot `br` launcher, tealdeer cache, kak-tree-sitter grammars).
6. Login shell → zsh; with WSL, the `final` hook warns if `win32yank.exe` is missing on the Windows side.

## Gotchas captured here

- **Never install `base-devel`**: it depends on `sudo`, which conflicts with fudo-git.
- The **znver4 repos** need a Zen 4+ CPU. The hook refuses to run on anything else.
- `makepkg.conf` (`-march=native -O3`, LTO) is not tracked: it ships that way in CachyOS's `pacman`.
- WSL: `appendWindowsPath = false` in `wsl.conf`. The WSL drop-in adds back only System32 and `C:\Users\NAME\.local\bin` (where win32yank lives).
- WSL: `.wslconfig` (mirrored networking, 24 GiB) is copied to the Windows side, not symlinked.
- btop and opencode rewrite their own configs, so those are copies. After changing settings in the app, run `mise dot add <path>`.
- broot opens files in Kakoune: Enter is a verb in `verbs.hjson`; double-click is hard-wired to the system opener, so `broot-open` is also installed as `wslview`/`xdg-open` in `~/.local/lib/broot-opener`, a dir only broot gets on PATH (`broot()` in `.zshrc`, `kakbr-sidebar`). In `kakbr`'s sidebar both go to kakbr's kak; elsewhere in tmux, to a kak pane in broot's window (kakrc labels each kak client's pane). `kakmux` and `kakbr` each run their own tmux server (`kakmux-PID`, `kakbr-PID`), so each is one pane in whatever runs it; kakbr's right pane is just a `kakmux`.
- kak-tree-sitter turns off Kakoune's own highlighting for every language it knows, grammar installed or not. So kakrc writes `~/.config/kak-tree-sitter/config.toml` (not tracked; regenerated when the installed set changes) to hand every language without a grammar back to Kakoune. The post-dotfiles hook installs a handful (C/C++, Rust, Python, Bash, Markdown, TOML, JSON, YAML); add more with `ktsctl sync <lang>`.
- Not captured: `~/.config/opencode/service.json` (holds a password), project checkouts like `~/tracehook`, timezone/hostname files that WSL generates.
