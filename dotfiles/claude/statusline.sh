#!/bin/sh
# Claude Code's status line (statusLine in managed-settings.json, so claude and
# claude-go share it). In the accent colour (the spinner's): which one this is
# (claude-go is the one with CLAUDE_CONFIG_DIR=~/.claude.go). After it, in the
# footer's grey (the theme's inactive, as "shift+tab to cycle"): the model and
# its effort, the directory @ git branch with its changes (*N files changed,
# ↑ahead ↓behind), how full the context is, and the 5-hour and weekly limits'
# use (subscription) or the cost so far (API key; not on claude-go, where it
# would be priced as if Anthropic served it). claude-go shows OpenCode Go's own
# limits instead (5-hour, weekly, monthly), from Go's usage endpoint; that is
# fetched in the background at most once a minute into go-usage.json beside its
# config, and each run shows what is there. Claude Code puts this row above
# its own mode row ("auto mode on"), and nothing can share or reorder them.
case ${CLAUDE_CONFIG_DIR:-} in
	*/.claude.go) name=go rgb='106;155;204' ;;
	*) name=claude rgb='215;119;87' ;;
esac
us=$(printf '\037')
IFS=$us read -r model effort dir ctx size five week cost <<EOF2
$(jq -r '[.model.display_name // .model.id, .effort.level, .workspace.current_dir // .cwd,
	.context_window.used_percentage, .context_window.context_window_size,
	.rate_limits.five_hour.used_percentage, .rate_limits.seven_day.used_percentage,
	.cost.total_cost_usd]
	| map(. // "" | tostring) | join("\u001f")' 2>/dev/null)
EOF2

left=
[ -n "$model" ] && left=" · $model"
[ -n "$effort" ] && left="$left · $effort"
if [ -n "$dir" ]; then
	git=$(git -C "$dir" --no-optional-locks status --porcelain=v2 --branch 2>/dev/null | awk '
		/^# branch\.head / { head = $3 }
		/^# branch\.oid / { oid = substr($3, 1, 7) }
		/^# branch\.ab / { ahead = substr($3, 2) + 0; behind = substr($4, 2) + 0 }
		!/^#/ { n++ }
		END {
			if (head == "") exit
			s = head == "(detached)" ? oid : head
			if (n) s = s " *" n
			if (ahead) s = s " ↑" ahead
			if (behind) s = s " ↓" behind
			print s
		}')
	case $dir in "$HOME") dir='~' ;; "$HOME"/*) dir="~${dir#"$HOME"}" ;; esac
	left="$left │ $dir${git:+ @ $git}"
fi

right=
add() { right="${right:+$right · }$1"; }
if [ -n "$ctx" ]; then
	case $size in
		'') of= ;;
		*000000) of=" of ${size%000000}M" ;;
		*000) of=" of ${size%000}k" ;;
		*) of=" of $size" ;;
	esac
	add "$(printf '%.0f' "$ctx")%$of ctx"
fi
if [ "$name" = go ]; then
	usage=$CLAUDE_CONFIG_DIR/go-usage.json
	if [ $(($(date +%s) - $(stat -c %Y "$usage" 2>/dev/null || echo 0))) -ge 60 ]; then
		touch "$usage"	# the next minute's run retries a failed fetch, not every run
		{ curl -sf -m 10 -H "Authorization: Bearer $(cat "$CLAUDE_CONFIG_DIR/opencode-go.key")" \
			https://opencode.ai/inference/go/v1/usage >"$usage.tmp" && mv "$usage.tmp" "$usage"; } >/dev/null 2>&1 &
	fi
	IFS=$us read -r five week month <<EOF2
$(jq -r '.usage | [.rolling.percent, .weekly.percent, .monthly.percent]
	| map(. // "" | tostring) | join("\u001f")' "$usage" 2>/dev/null)
EOF2
	limits=
	for l in "5h $five" "7d $week" "1m $month"; do
		[ -n "${l#* }" ] && limits="${limits:+$limits · }${l% *} $(printf '%.0f' "${l#* }")%"
	done
	[ -n "$limits" ] && add "$limits"
elif [ -n "$five$week" ]; then
	add "${five:+5h $(printf '%.0f' "$five")%}${five:+${week:+ · }}${week:+7d $(printf '%.0f' "$week")%}"
elif [ -n "$cost" ] && [ "$name" = claude ]; then
	add "\$$(printf '%.2f' "$cost")"
fi

printf '\033[38;2;%sm● %s\033[38;2;153;153;153m%s%s\033[0m' "$rgb" "$name" "$left" "${right:+ │ $right}"
