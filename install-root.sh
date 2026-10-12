#!/usr/bin/env bash
# Stage 0: run once as root on a fresh Arch install or WSL distro, before `mise bootstrap`.
# mise runs as your user and elevates with `sudo`, which here is fudo -> doas,
# so the user, wheel membership and doas.conf have to exist before it can run.
#
#   pacman -Sy --noconfirm git && git clone <this repo> /tmp/setup && /tmp/setup/install-root.sh
set -euo pipefail

(( EUID == 0 )) || { echo "run as root" >&2; exit 1; }
user=${1:-sochinorth}
here=$(cd -- "$(dirname -- "$0")" && pwd)

[[ -s /etc/pacman.d/gnupg/pubring.gpg ]] || { pacman-key --init; pacman-key --populate archlinux; }
pacman -Syu --needed --noconfirm git opendoas zsh mise

install -m644 "$here/files/etc/doas.conf" /etc/doas.conf

# wsl.conf sets the default user and systemd, which the first restart needs, so
# it can't wait for `mise -E wsl bootstrap` (which keeps it in sync afterwards).
wsl=0
grep -qi microsoft /proc/sys/kernel/osrelease && wsl=1
(( wsl )) && install -m644 "$here/wsl/etc/wsl.conf" /etc/wsl.conf

if id "$user" >/dev/null 2>&1; then
	usermod -aG wheel "$user"
else
	useradd -m -G wheel -s /usr/bin/zsh "$user"
	passwd "$user"
fi

if (( wsl )); then
	cat <<EOF

Root stage done. From Windows run:  wsl --terminate archlinux
Then, logged in as $user:
  git clone --recurse-submodules <this repo> ~/setup && cd ~/setup && mise trust && mise -E wsl bootstrap
EOF
else
	cat <<EOF

Root stage done. Log in as $user, then:
  git clone --recurse-submodules <this repo> ~/setup && cd ~/setup && mise trust && mise bootstrap
EOF
fi
