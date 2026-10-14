# Windows interop is off in /etc/wsl.conf (appendWindowsPath = false); add back
# only System32 (cmd.exe, clip.exe, wsl.exe). win32yank.exe is in /usr/bin.
path+=('/mnt/c/Windows/System32')
