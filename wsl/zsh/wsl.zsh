# Windows interop is off in /etc/wsl.conf (appendWindowsPath = false); add back
# only System32 and the Windows-side bin dir that holds win32yank.exe. The
# Windows home comes from wsl/bin/winhome (cached, so read straight from its
# cache on every start after the first).
() {
	local cache=${XDG_CACHE_HOME:-~/.cache}/wsl-winhome home
	if [[ -s $cache ]]; then home=$(<$cache)
	else home=$(${${(%):-%x}:A:h:h}/bin/winhome 2>/dev/null)
	fi
	path+=('/mnt/c/Windows/System32' ${home:+$home/.local/bin})
}
