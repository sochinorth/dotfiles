#!/usr/bin/env bash
# Coherently copy, verify, and compact OpenCode's SQLite database.
set -euo pipefail

usage() {
	cat >&2 <<'EOF'
usage: opencode-db-vacuum.sh --prepare | --apply

  --prepare  Back up the live database online, verify it, and write a
             compacted copy under the OpenCode data directory.
  --apply    Stop OpenCode, create a fresh coherent backup, compact it,
             atomically install it, and restart OpenCode.
EOF
}

die() {
	printf 'opencode-db-vacuum: %s\n' "$*" >&2
	exit 1
}

say() {
	printf 'opencode-db-vacuum: %s\n' "$*" >&2
}

(( EUID != 0 )) || die 'run as your normal user, not root'
command -v opencode >/dev/null || die 'opencode is not installed'
command -v sqlite3 >/dev/null || die 'sqlite3 is not installed'

service_unit=''
if command -v systemctl >/dev/null && \
	systemctl --user cat dev.mise.opencode.service >/dev/null 2>&1; then
	service_unit=dev.mise.opencode.service
fi
web_gui_unit=''
if command -v systemctl >/dev/null && \
	systemctl --user cat dev.mise.opencode.web-gui.service >/dev/null 2>&1; then
	web_gui_unit=dev.mise.opencode.web-gui.service
fi

case "${1:-}" in
	--prepare|--apply) mode=$1 ;;
	*) usage; exit 2 ;;
esac

db=$(opencode debug paths db)
[[ -n $db && $db != :memory: && -f $db ]] || die "database is unavailable: $db"
db_dir=${db%/*}
[[ $db_dir != "$db" ]] || db_dir=.
db_name=${db##*/}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=$db_dir/db-backups
workdir=$(mktemp -d -- "$db_dir/.opencode-db-vacuum.XXXXXX")
stopped=0
web_gui_stopped=0
web_gui_was_active=0
old_moved=0
new_moved=0
restart_done=0
old_db=''
old_wal=''
old_shm=''

service_is_active() {
	if [[ -n $service_unit ]]; then
		systemctl --user is-active --quiet "$service_unit"
	else
		pgrep -f '[o]pencode serve --service' >/dev/null 2>&1
	fi
}

service_stop() {
	if [[ -n $service_unit ]]; then
		systemctl --user stop "$service_unit"
	else
		opencode service stop >/dev/null
	fi
}

service_start() {
	if [[ -n $service_unit ]]; then
		systemctl --user start "$service_unit"
	else
		opencode service start >/dev/null
	fi
}

web_gui_is_active() {
	[[ -n $web_gui_unit ]] && systemctl --user is-active --quiet "$web_gui_unit"
}

web_gui_stop() {
	[[ -n $web_gui_unit ]] && systemctl --user stop "$web_gui_unit"
}

web_gui_start() {
	[[ -n $web_gui_unit ]] && systemctl --user start "$web_gui_unit"
}

cleanup() {
	local status=$?
	if (( stopped && !restart_done )); then
		service_start >/dev/null 2>&1 || true
	fi
	if (( web_gui_stopped && !restart_done && web_gui_was_active )); then
		web_gui_start >/dev/null 2>&1 || true
	fi
	if (( old_moved && !new_moved )) && [[ ! -e $db && -e $old_db ]]; then
		mv -- "$old_db" "$db" || true
		[[ -e $old_wal ]] && mv -- "$old_wal" "$db-wal" || true
		[[ -e $old_shm ]] && mv -- "$old_shm" "$db-shm" || true
	fi
	rm -rf -- "$workdir"
	exit "$status"
}
trap cleanup EXIT

mkdir -p -- "$backup_dir"
chmod 700 -- "$backup_dir"

check_integrity() {
	local file=$1
	[[ $(sqlite3 "$file" 'PRAGMA integrity_check;') == ok ]] \
		|| die "integrity check failed: $file"
}

make_compacted_copy() {
	local snapshot=$workdir/$db_name.snapshot
	local compact=$workdir/$db_name.compact

	say 'taking a coherent SQLite backup'
	sqlite3 "$db" <<SQL
.timeout 10000
.backup '$snapshot'
SQL
	check_integrity "$snapshot"
	cp --reflink=auto -- "$snapshot" "$compact"
	chmod --reference="$db" "$compact"
	say 'vacuuming the backup copy'
	sqlite3 "$compact" 'VACUUM;'
	check_integrity "$compact"

	printf '%s\n' "$snapshot" "$compact"
}

if [[ $mode == --prepare ]]; then
	mapfile -t copies < <(make_compacted_copy)
	snapshot=${copies[0]}
	compact=${copies[1]}
	ready_snapshot=$backup_dir/$db_name.snapshot.$timestamp
	ready_compact=$backup_dir/$db_name.compacted.$timestamp
	cp --reflink=auto -- "$snapshot" "$ready_snapshot"
	cp --reflink=auto -- "$compact" "$ready_compact"
	chmod --reference="$db" "$ready_snapshot" "$ready_compact"
	say "coherent snapshot: $ready_snapshot"
	say "compacted copy: $ready_compact"
	stat -c 'original=%s bytes' "$db"
	stat -c 'compacted=%s bytes' "$ready_compact"
	exit 0
fi

service_is_active \
	|| die 'OpenCode service is not running; refusing an unattended swap'

if web_gui_is_active; then
	web_gui_was_active=1
	say 'stopping OpenCode web GUI proxy'
	web_gui_stopped=1
	web_gui_stop
fi

say 'stopping OpenCode service'
stopped=1
service_stop
for _ in {1..50}; do
	if ! service_is_active; then
		break
	fi
	sleep 0.1
done
service_is_active && die 'OpenCode service did not stop'

mapfile -t copies < <(make_compacted_copy)
snapshot=${copies[0]}
compact=${copies[1]}
old_db=$backup_dir/$db_name.before-vacuum.$timestamp
old_wal=$old_db-wal
old_shm=$old_db-shm

say "preserving original database as $old_db"
mv -- "$db" "$old_db"
old_moved=1
[[ -e $db-wal ]] && mv -- "$db-wal" "$old_wal"
[[ -e $db-shm ]] && mv -- "$db-shm" "$old_shm"

mv -- "$compact" "$db"
new_moved=1
chmod --reference="$old_db" "$db"
check_integrity "$db"

say 'starting OpenCode service'
service_start >/dev/null
service_is_active || die 'OpenCode service did not start'
if (( web_gui_was_active )); then
	say 'starting OpenCode web GUI proxy'
	web_gui_start >/dev/null
	web_gui_is_active || die 'OpenCode web GUI proxy did not start'
fi
restart_done=1
say "installed compacted database; original backup: $old_db"
stat -c 'installed=%s bytes' "$db"
