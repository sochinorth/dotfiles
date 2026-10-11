#!/usr/bin/env bash
# pre-packages hook. mise installs [bootstrap.packages] with `sudo`, and almost
# every package comes from CachyOS / Chaotic-AUR, so before that phase this
# makes sure (1) those repos are configured and trusted and (2) `sudo` exists,
# which on this machine is fudo-git (a sudo -> doas shim from the AUR).
# Safe to re-run: every step checks its own state first.
set -euo pipefail

here=$(cd -- "$(dirname -- "$0")/.." && pwd)

die() { printf 'pre-packages: %s\n' "$*" >&2; exit 1; }
say() { printf 'pre-packages: %s\n' "$*"; }

(( EUID != 0 )) || die "run mise bootstrap as your user (paru and makepkg refuse root); see install-root.sh"
command -v doas >/dev/null || die "doas missing; run install-root.sh as root first"

# The cachyos-*-znver4 repos ship -march=znver4 builds, which die with SIGILL
# on anything older than Zen 4. Zen 4+ is the only AMD with AVX-512.
grep -q '^vendor_id.*AuthenticAMD' /proc/cpuinfo && grep -qw avx512f /proc/cpuinfo \
	|| die "CPU is not Zen 4+; switch files/etc/pacman.conf to the cachyos-v3/v4 repos first"

same() { [[ -e $2 && "$(<"$1")" == "$(<"$2")" ]]; }

# --- third-party repos -------------------------------------------------------

# CachyOS, Chaotic-AUR (Pedro Henrique Lara Campos)
for key in F3B607488DB35A47 3056513887B78AEB; do
	if ! pacman-key --list-keys "$key" >/dev/null 2>&1; then
		say "importing repo key $key"
		doas pacman-key --recv-keys "$key" --keyserver keyserver.ubuntu.com
		doas pacman-key --lsign-key "$key"
	fi
done

# pacman.conf Includes these lists, and pacman refuses to start when one is
# missing, so seed them; the *-mirrorlist packages take them over below.
for list in cachyos cachyos-v3 cachyos-v4 chaotic; do
	[[ -e /etc/pacman.d/$list-mirrorlist ]] \
		|| doas install -m644 "$here/files/seed/$list-mirrorlist" /etc/pacman.d/
done

for f in pacman.conf pacman.d/mirrorlist; do
	same "$here/files/etc/$f" "/etc/$f" || doas install -m644 "$here/files/etc/$f" "/etc/$f"
done

repo_pkgs=(cachyos-keyring cachyos-mirrorlist cachyos-v3-mirrorlist cachyos-v4-mirrorlist
	chaotic-keyring chaotic-mirrorlist)
if ! pacman -Q "${repo_pkgs[@]}" >/dev/null 2>&1; then
	say "enabling CachyOS + Chaotic-AUR"
	doas pacman -Syu --noconfirm --overwrite '/etc/pacman.d/*-mirrorlist' "${repo_pkgs[@]}"
	# Same as CachyOS's own installer: reinstall everything so it comes from the
	# optimized repos (they're listed first in pacman.conf), pacman included.
	pacman -Qqn | doas pacman -S --noconfirm -
fi

# --- sudo = fudo -> doas -----------------------------------------------------

# base-devel is deliberately not used anywhere: it depends on real sudo.
if ! pacman -Q fudo-git >/dev/null 2>&1; then
	say "installing fudo-git from the AUR"
	doas pacman -S --needed --noconfirm git make gcc fakeroot opendoas paru

	# fudo conflicts with sudo. Remove the real one only after doas is proven,
	# because afterwards doas is the only way back to root.
	doas true || die "doas does not work for $USER; check /etc/doas.conf and wheel membership"
	if pacman -Qqo /usr/bin/sudo 2>/dev/null | grep -qx sudo; then
		doas pacman -Rdd --noconfirm sudo
	fi
	# --sudo doas: paru's default is sudo, which is exactly what this installs.
	paru -S --aur --noconfirm --sudo doas fudo-git
fi
