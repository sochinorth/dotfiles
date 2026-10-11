# Windows interop is off in /etc/wsl.conf (appendWindowsPath = false); add back
# only System32 and the Windows-side bin dir that holds win32yank.exe.
path+=('/mnt/c/Windows/System32' '/mnt/c/Users/NAME/.local/bin')
