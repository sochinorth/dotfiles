# setup

Arch (CachyOS repos), reproducible with `mise bootstrap` (mise ≥ 2026.9).

## Layout

| File | What it is | Sources |
| --- | --- | --- |
| `mise.toml` | Generic: repos, doas/fudo, packages, `/etc` basics, dotfiles | `files/`, `dotfiles/`, `scripts/` |
| `mise.wsl.toml` | WSL module: `wsl.conf`, xclip → win32yank shim, `.wslconfig`, Windows PATH, win32yank check | `wsl/` |
| `.miserc.local.toml` | Per machine, gitignored: which modules a plain `mise bootstrap` loads | |
| `dotfiles/config/kak` | Kakoune: kakrc, kakbr, `kakmux`/`kakbr-sidebar`/`broot-open`, `kak()`/`kakbr()`; the [kakmux](https://github.com/sochinorth/kakmux) repo as a submodule, with its own tests | mise links each file (`[dotfiles]`) |
| `dotfiles/claude` | Claude Code, in layers: `managed-settings.json` is what's shared (plugins such as [idasql-skills](https://github.com/allthingsida/idasql-skills), from marketplaces declared there); `settings.json` stays Claude Code's to write (`settings.claude.json` seeds it); themes | mise: managed settings into `/etc/claude-code` (`[bootstrap.files]`), the rest into `~/.claude` (`[dotfiles]`) |
| `dotfiles/fortune` | fortune cookies fortune-mod doesn't ship: its offensive (`-off`) set, which Arch builds without, and others (sources below) | mise links each into `~/.local/share/fortune`; `post-dotfiles` runs `strfile` |
| `README.local.md` | Per machine, gitignored: notes about this machine (what isn't captured, where) | |

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
git clone --recurse-submodules <this repo> ~/setup && cd ~/setup
mise trust && mise -E wsl bootstrap --dry-run && mise -E wsl bootstrap   # drop -E wsl on bare metal
```

Then copy `~/.ssh/id_ed25519_*` over by hand (keys are deliberately not in the repo). Hosts that only matter on one machine go in `~/.ssh/config.local`, which `~/.ssh/config` includes.

The Kakoune config (`dotfiles/config/kak`) is a submodule, cloned over HTTPS
(no keys needed yet). A clone made without `--recurse-submodules` gets it from
the `pre-dotfiles` hook; by hand, `git submodule update --init`. After pulling a
commit that moves it, `git submodule update` (that checks out the recorded
commit: commit and push work in the submodule first).

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
5. The `pre-dotfiles` hook (checks out the submodules if the clone lacks them), `[dotfiles]`, then the `post-dotfiles` hook (broot `br` launcher, tealdeer cache, kak-tree-sitter grammars, agent skill links).
6. Login shell → zsh; with WSL, the `final` hook warns if `win32yank.exe` is missing on the Windows side.

## Gotchas captured here

- **Never install `base-devel`**: it depends on `sudo`, which conflicts with fudo-git.
- The **znver4 repos** need a Zen 4+ CPU. The hook refuses to run on anything else.
- `makepkg.conf` (`-march=native -O3`, LTO) is not tracked: it ships that way in CachyOS's `pacman`.
- WSL: `appendWindowsPath = false` in `wsl.conf`. The WSL drop-in adds back only System32 and `%USERPROFILE%\.local\bin` (where win32yank lives). The Windows home is found, not configured: `wsl/bin/winhome` asks Windows once (`%USERPROFILE%`) and caches the answer in `~/.cache/wsl-winhome`.
- WSL: `.wslconfig` (Consomme networking; `memory=` 85% of the host's RAM, filled in then) is written to the Windows side by the `final` hook, not symlinked, and not a `[dotfiles]` entry (its path depends on the Windows user).
- Cookies in `dotfiles/fortune`, each as published (checked 2026-10-13, all at their latest): the `-off` files are [fortune-mod](https://github.com/shlomif/fortune-mod)'s `datfiles/off/unrotated`; `archlinux` from the AUR's fortune-mod-archlinux; `billwurtz` from [Ev1lbl0w/fortune-mod-billwurtz](https://github.com/Ev1lbl0w/fortune-mod-billwurtz); `g` is [ketogenesis/gfortune](https://github.com/ketogenesis/gfortune)'s `gsource`; `lambda` is [LAMBDA.TXT](http://www.gotlisp.com/lambda/lambda.txt) v11; `linuxorgru` is the lorquotes.ru dump (2021.07, via the AUR's fortune-mod-lorquotes; the site is gone). Plain `fortune` (stock build) shows the `-off` ones like any others.
- btop rewrites its own config, so that one is a copy. After changing settings in the app, run `mise dot add <path>`.
- broot opens files in Kakoune: Enter is a verb in `verbs.hjson`; double-click is hard-wired to the system opener, so `broot-open` is also installed as `wslview`/`xdg-open` in `~/.local/lib/broot-opener`, a dir only broot gets on PATH (`broot()` in kakmux's `shell/kakmux.zsh`, which `.zshrc` sources; `kakbr-sidebar`). In `kakbr`'s sidebar both go to kakbr's kak; elsewhere in tmux, to a kak pane in broot's window (kakrc labels each kak client's pane). `kakmux` and `kakbr` each run their own tmux server (`kakmux-PID`, `kakbr-PID`), so each is one pane in whatever runs it; kakbr's right pane is just a `kakmux`.
- kak-tree-sitter turns off Kakoune's own highlighting for every language it knows, grammar installed or not. So kakrc writes `~/.config/kak-tree-sitter/config.toml` (not tracked; regenerated when the installed set changes) to hand every language without a grammar back to Kakoune. The post-dotfiles hook installs a handful (C/C++, Rust, Python, Bash, Markdown, TOML, JSON, YAML); add more with `ktsctl sync <lang>`.
- Not captured: secrets (SSH keys, app credentials), project checkouts, timezone/hostname files that WSL generates. What that means on a given machine goes in its `README.local.md`.
