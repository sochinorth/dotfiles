# Port of dotfiles/config/helix/{config,languages}.toml. Lines that don't carry over
# are kept as comments saying why.

# --- tree-sitter, LSP --------------------------------------------------------
# Helix's built-ins, here kak-tree-sitter (highlighting, text objects) and
# kakoune-lsp; see [editor.lsp] below. Both set default faces as they load,
# so they come before the colour scheme. Those defaults are kept in
# plugin_faces for :colorscheme to reset to, for schemes that don't set them.
declare-option -hidden str plugin_faces
evaluate-commands %sh{
	command -v kak-tree-sitter >/dev/null || exit
	# Grammars are installed one language at a time (`ktsctl sync rust`).
	# kak-tree-sitter turns off Kakoune's highlighter for every language it
	# knows, grammar or not, so its config (written here, whenever the set
	# installed changes) leaves the others to Kakoune.
	data=${XDG_DATA_HOME:-$HOME/.local/share}/kak-tree-sitter
	conf=${XDG_CONFIG_HOME:-$HOME/.config}/kak-tree-sitter/config.toml
	have=
	for d in "$data"/queries/*/; do
		[ -d "$d" ] || continue
		d=${d%/}; have="$have ${d##*/}"
	done
	head=; [ -r "$conf" ] && IFS= read -r head < "$conf"
	if [ "$head" != "# installed:$have" ]; then
		mkdir -p "${conf%/*}" && {
			echo "# installed:$have"
			echo "# Written by kakrc from what's installed in $data: don't edit."
			ktsctl default-config |
				sed -n 's/^\[language\."\([^"]*\)".*/\1/p; s/^\[language\.\([^]."]*\).*/\1/p' |
				sort -u |
				while IFS= read -r l; do
					case "$have " in *" $l "*) continue ;; esac
					printf '\n[language."%s"]\nfiletype_hook = false\nremove_default_highlighter = false\n' "$l"
				done
		} > "$conf.tmp" && mv -f -- "$conf.tmp" "$conf"
		# a server already running (one serves all sessions) rereads it
		kak-tree-sitter -r "{ \"metadata\": { \"session\": \"$kak_session\" }, \"payload\": { \"type\": \"reload\" } }" >/dev/null 2>&1
	fi
	# its server (started by the first session), which this session joins
	rc=$(kak-tree-sitter -dks --init "$kak_session") || exit
	printf '%s\n' "$rc"
	# ts_<scope> faces link to their parent scope's, some of which it leaves
	# undefined (ts_markup for ts_markup_bold, ...): define those too
	faces= names=' '
	while IFS= read -r l; do
		case $l in 'set-face global ts_'*) ;; *) continue ;; esac
		faces="$faces$l
"
		l=${l#set-face global }; names="$names${l%% *} "
	done <<-EOF
		$rc
	EOF
	missing=$faces
	while [ -n "$missing" ]; do
		next=
		while IFS= read -r l; do
			[ -n "$l" ] || continue
			p=${l##* }
			case $names in *" $p "*) continue ;; esac
			case $p in ts_*) ;; *) continue ;; esac
			q=${p#ts_}
			case $q in *_*) q=ts_${q%_*} ;; *) q=default ;; esac
			names="$names$p "
			next="${next}set-face global $p $q
"
		done <<-EOF
			$missing
		EOF
		faces=$faces$next missing=$next
	done
	printf %s "$faces"
	printf "set-option -add global plugin_faces '%s'\n" "$faces"
}
evaluate-commands %sh{
	command -v kak-lsp >/dev/null || exit
	rc=$(kak-lsp) || exit
	printf '%s\n' "$rc"
	faces=
	while IFS= read -r l; do
		case $l in 'set-face global '*) faces="$faces$l
" ;; esac
	done <<-EOF
		$rc
	EOF
	printf "set-option -add global plugin_faces '%s'\n" "$faces"
}

# Faces this kakrc draws with, for colour schemes that don't set them: the
# hover/completion docs kak-lsp writes in markup, the modeline's diagnostic
# counts, the git gutter. Kept with the plugins' defaults above.
set-option -add global plugin_faces %{
set-face global InfoDefault Information
set-face global InfoHeader +b@Information
set-face global InfoMono Information
set-face global InfoBlock Information
set-face global InfoBlockQuote +i@Information
set-face global InfoBullet Information
set-face global InfoLink +u@Information
set-face global InfoLinkMono +u@Information
set-face global InfoRule Information
set-face global InfoDiagnosticError red
set-face global InfoDiagnosticWarning yellow
set-face global InfoDiagnosticInformation blue
set-face global InfoDiagnosticHint green
set-face global StatusLineError red
set-face global StatusLineWarning yellow
set-face global GitGutterAdd green
set-face global GitGutterModify yellow
set-face global GitGutterDelete red
}
evaluate-commands %opt{plugin_faces}

# --- theme -------------------------------------------------------------------
# Kakoune ships no onedark; colors/onedark.kak is a port of Helix's, tree-sitter
# scopes and all. StatusLineInactive (see "inactive status lines" below) is set
# first so that colour schemes can override it.
set-face global StatusLineInactive '+d@StatusLine'
colorscheme onedark

# --- [editor] ----------------------------------------------------------------
# bufferline = "multiple": drawn in tmux's status line, see the bufferline
# section below and ~/.local/bin/kakmux.
# preview-completion-insert = false: nothing to set. Only <c-n>/<c-p> pick a
# candidate (Tab, Enter and arrows never do), and picking one does put it in
# the text straight away. Ignore the menu and nothing gets inserted.

# No completion menu straight after entering insert mode, only once something
# has been typed in it (<c-x> still asks for one). autocomplete can't do this:
# insert mode reads it once, before its ModeChange hook runs. completers is
# read each time, so it's emptied until the first character typed.
declare-option -hidden str-list insert_completers
hook global ModeChange push:.*:insert %{
	set-option window insert_completers %opt{completers}
	set-option window completers
	hook -once -group insert-completers window InsertChar .* insert-completers-restore
	hook -once -group insert-completers window ModeChange pop:insert:.* insert-completers-restore
}
define-command -hidden insert-completers-restore %{
	remove-hooks window insert-completers
	set-option window completers %opt{insert_completers}
}

# auto-save.focus-lost = true (needs a terminal that reports focus events).
# A picker's tmux popup takes the focus too, but that isn't leaving the editor
# (see picker_clients below).
hook global FocusOut .* %{
	evaluate-commands %sh{
		eval set -- "$kak_quoted_opt_picker_clients"
		for c; do [ "$c" = "$kak_client" ] && exit; done
		echo 'try %{ write-all }'
	}
}

# indent-guides.render = true: no indent guides. Indentation here is tabs (see
# below), so drawing tabs as a bar gives much the same picture.
add-highlighter global/ show-whitespaces -tab '│' -tabpad ' ' -spc ' ' -lf ' ' -nbsp '⍽'

# soft-wrap.enable = true
add-highlighter global/ wrap -word -indent

# Like Helix, opening a file over the blank startup *scratch* replaces it
# rather than leaving it behind (:e, pickers, anything that switches buffer).
# A *scratch* with anything in it, and edit -scratch buffers, are left alone,
# and so is one another client (another split) still shows: it goes once
# that one moves off it too.
# (Kakoune's regex lookarounds can't hold $, hence no anchor.)
define-command -hidden fail-if-on-scratch %{
	evaluate-commands %sh{ [ "$kak_bufname" = '*scratch*' ] && echo fail }
}
hook global WinDisplay (?!\*scratch\*).* %{
	try %{
		evaluate-commands -buffer *scratch* %{ execute-keys '%<a-k>\A\s*\z<ret>' }
		evaluate-commands %sh{
			eval set -- "$kak_quoted_client_list"
			for c; do
				printf "evaluate-commands -client '%s' fail-if-on-scratch\n" "$(printf %s "$c" | sed "s/'/''/g")"
			done
		}
		delete-buffer *scratch*
	}
}

# Helix's quit-all family. kill ends the session: every client, so in
# kakmux every split, and refuses while buffers have unsaved changes.
alias global qa       kill
alias global quit-all kill
alias global qa!      kill!
define-command write-quit-all -docstring 'write all buffers, then quit all clients' %{
	write-all
	kill
}
define-command -hidden write-quit-all-force %{
	write-all
	kill!
}
alias global wqa  write-quit-all
alias global xa   write-quit-all
alias global wqa! write-quit-all-force
alias global xa!  write-quit-all-force
alias global x    write-quit
alias global x!   write-quit!

# Inactive status lines, like Helix: a client whose terminal (its kakmux
# split) doesn't have focus draws its status line in StatusLineInactive. That
# defaults to the status line dimmed; colour schemes may set their own.
# Add to statusline_faces any face a custom modelinefmt uses.
declare-option str-list statusline_faces StatusLine StatusLineMode StatusLineInfo StatusLineValue StatusCursor StatusLineError StatusLineWarning
declare-option -hidden str-list unfocused_clients

# faces live per window (client + buffer), so reapply on every buffer switch
define-command -hidden statusline-apply-focus %{
	evaluate-commands %sh{
		eval set -- "$kak_quoted_opt_unfocused_clients"
		dim=; for c; do [ "$c" = "$kak_client" ] && dim=1; done
		# its own picker popup having the focus doesn't count
		eval set -- "$kak_quoted_opt_picker_clients"
		for c; do [ "$c" = "$kak_client" ] && dim=; done
		eval set -- "$kak_quoted_opt_statusline_faces"
		for f; do
			if [ -n "$dim" ]; then
				echo "set-face window $f StatusLineInactive"
			else
				echo "try %{ unset-face window $f }"
			fi
		done
	}
}
hook global FocusOut .* %{
	set-option -remove global unfocused_clients %val{client}
	set-option -add global unfocused_clients %val{client}
	statusline-apply-focus
}
hook global FocusIn .* %{
	set-option -remove global unfocused_clients %val{client}
	statusline-apply-focus
}
hook global WinDisplay .* statusline-apply-focus
hook global ClientClose .* %{ set-option -remove global unfocused_clients %val{hook_param} }

# Under kakmux every split is a client of the same session, so the default
# status line's " - client@[session]" tail is just noise there: strip it from
# whatever modelinefmt is in effect (a no-op once the format is customised).
hook global WinDisplay .* %{
	evaluate-commands %sh{
		case ${kak_client_env_TMUX%%,*} in */kakmux-*) ;; *) exit ;; esac
		fmt=$(printf %s "$kak_opt_modelinefmt" | sed 's/ - %val{client}@\[%val{session}\]$//')
		[ "$fmt" = "$kak_opt_modelinefmt" ] && exit
		printf "set-option window modelinefmt '%s'\n" "$(printf %s "$fmt" | sed "s/'/''/g")"
	}
}

# Helix defaults that Kakoune doesn't turn on by itself. The gutter's columns
# go right to left in the order they're added: the git gutter (see below)
# right of the line numbers, diagnostics (kak-lsp, later) left of them.
declare-option -hidden line-specs git_gutter_flags
add-highlighter global/git-gutter flag-lines Default git_gutter_flags
add-highlighter global/ number-lines -hlcursor
add-highlighter global/ show-matching

# --- [editor.lsp] / diagnostics -----------------------------------------------
# kakoune-lsp (loaded at the top), for every filetype it has a server for:
# its lsp_servers hooks (in kak-lsp's servers.kak) pick the server, which must
# be installed (C/C++: clangd; sh: bash-language-server; markdown: marksman).
try %{
	lsp-enable
	# lsp.snippets = false
	set-option global lsp_snippet_support false
	# Helix defaults: signature help while typing a call's arguments, and
	# no code-action indicator (kak-lsp's 💡 in the modeline, which asks the
	# server for actions whenever keys stop)
	lsp-auto-signature-help-enable
	set-option global lsp_auto_show_code_actions false
	# end-of-line-diagnostics: every severity, not just warnings and up
	# (kak-lsp can't filter them); like Helix, the worst one's message two
	# spaces after the line, no mark per diagnostic. Drawn by the inline
	# diagnostics below (which leave out the cursor's line), not kak-lsp.
	set-option global lsp_inlay_diagnostic_sign ''
	set-option global lsp_inlay_diagnostic_gap ' '
	# lsp.display-progress-messages: progress (and pending server messages)
	# at the start of the modeline. Not the rest of kak-lsp's modeline: no
	# breadcrumbs (Helix has none, and they're a request whenever keys stop)
	remove-hooks global lsp-breadcrumbs
	set-option global modelinefmt "%%opt{lsp_modeline_progress}%%opt{lsp_modeline_message_requests}{StatusLineWarning}%%opt{lsp_diag_warnings}{StatusLineError}%%opt{lsp_diag_errors}{StatusLine} %opt{modelinefmt}"
	# Helix's gutter mark, coloured by severity
	set-option global lsp_diagnostic_line_error_sign   '●'
	set-option global lsp_diagnostic_line_warning_sign '●'
	set-option global lsp_diagnostic_line_info_sign    '●'
	set-option global lsp_diagnostic_line_hint_sign    '●'
	# Helix's keys: g d/D/y/r/i, ]d [d, <space> k/r/a/h (and s/S/d/D: pickers)
	map global goto d '<esc>:lsp-definition<ret>'      -docstring 'definition (LSP)'
	map global goto D '<esc>:lsp-declaration<ret>'     -docstring 'declaration (LSP)'
	map global goto y '<esc>:lsp-type-definition<ret>' -docstring 'type definition (LSP)'
	map global goto r '<esc>:lsp-references<ret>'      -docstring 'references (LSP)'
	# gi is Kakoune's first non-blank; in Helix that's gs (which can't
	# extend here: G s moves like g s)
	map global goto i '<esc>:lsp-implementation<ret>'  -docstring 'implementation (LSP)'
	map global goto s '<esc>:execute-keys gi<ret>'     -docstring 'line begin (non-blank)'
	# ]d [d: to the next/previous diagnostic, as an object
	map global object d '<a-;>lsp-diagnostic-object error warning info hint<ret>' -docstring 'diagnostic (LSP)'
	map global user k ':lsp-hover<ret>'                -docstring 'hover (LSP)'
	map global user r ':lsp-rename-prompt<ret>'        -docstring 'rename (LSP)'
	map global user a ':lsp-code-actions<ret>'         -docstring 'code actions (LSP)'
	map global user h ':lsp-highlight-references<ret>' -docstring 'highlight references (LSP)'
	map global user l ':enter-user-mode lsp<ret>'      -docstring 'LSP mode (everything else)'
}
# --- inline diagnostics ------------------------------------------------------
# inline-diagnostics.cursor-line = "warning": the diagnostics on the cursor's
# line, each under the column it starts at, as lines below it:
#     foo(old, &tmp);
#         │     └─Use of undeclared identifier 'tmp'
#         └─Use of undeclared identifier 'old'
# kak-lsp only hands Kakoune each line's worst message, so whenever the
# diagnostics change this asks it for the list :lsp-diagnostics shows,
# catching it before it opens that buffer (lsp-show-goto-buffer, wrapped
# below), and keeps this file's part in line_diags. The end-of-line messages
# are drawn here too, from kak-lsp's, less the cursor line's when it has
# lines below.

declare-option -docstring 'severities shown below the cursor''s line' \
	str-list inline_diagnostics_severities error warning
# buffer: "line|column|severity|message" (byte column, as Kakoune counts)
declare-option -hidden str-list line_diags
declare-option -hidden int line_diags_n 0
# window: what's drawn, whether lines below are, for which cursor line,
# and a list asked for (see lsp-show-goto-buffer)
declare-option -hidden range-specs line_diags_view
declare-option -hidden line-specs line_diags_eol
declare-option -hidden int line_diags_drawn 0
declare-option -hidden int line_diags_seen 0
declare-option -hidden bool line_diags_pending false
declare-option -hidden str-list line_diags_dcols
declare-option -hidden int line_diags_eolcol
add-highlighter global/line-diags replace-ranges line_diags_view
add-highlighter global/line-diags-eol flag-lines -after Default line_diags_eol

# Helix's status line diagnostics: a coloured ● and the count, warnings
# then errors, each only when there are some. Set as kak-lsp publishes;
# the colours are in modelinefmt (markup in an option's value isn't read).
declare-option -hidden str lsp_diag_warnings
declare-option -hidden str lsp_diag_errors

# kak-lsp publishes into the buffer: the counts for the modeline, and each
# client showing it asks for the list
hook global BufSetOption lsp_inlay_diagnostics=.* %{
	evaluate-commands %sh{
		w=$kak_opt_lsp_diagnostic_warning_count e=$kak_opt_lsp_diagnostic_error_count
		[ "${w:-0}" -gt 0 ] && w=" ● $w" || w=
		[ "${e:-0}" -gt 0 ] && e=" ● $e" || e=
		echo "set-option buffer lsp_diag_warnings '$w'; set-option buffer lsp_diag_errors '$e'"
		double() {
			r= rest=$2
			while :; do
				case $rest in
				*"$1"*) r="$r${rest%%"$1"*}$1$1" rest=${rest#*"$1"} ;;
				*) r=$r$rest; return ;;
				esac
			done
		}
		double "'" "$kak_bufname"; b=$r
		eval set -- "$kak_quoted_client_list"
		for c; do
			double "'" "$c"
			printf "evaluate-commands -client '%s' %%{ line-diags-request-for '%s' }\n" "$r" "$b"
		done
	}
}
define-command -hidden -params 1 line-diags-request-for %{
	evaluate-commands %sh{
		[ "$1" = "$kak_bufname" ] && echo 'set-option window line_diags_pending true; lsp-diagnostics'
	}
}

# Where every kak-lsp list ends up (references, symbols, diagnostics, calls:
# `path:line:column:text` lines): the list asked for above is caught; one a
# workspace symbol picker asked for goes to it; the rest open in a picker
# (with tmux; else in kak-lsp's buffer, as before).
define-command -override -hidden lsp-show-goto-buffer -params 4..5 %{
	evaluate-commands %sh{
		if [ "$1" = '*diagnostics*' ] && [ "$kak_opt_line_diags_pending" = true ]; then
			echo 'set-option window line_diags_pending false; line-diags-capture %arg{3} %arg{4}'
		elif [ -n "$kak_opt_picker_wsym_out" ]; then
			echo 'picker-wsym-deliver %arg{3} %arg{4}'
		elif [ -n "$kak_client_env_TMUX" ]; then
			echo 'picker-locations %arg{1} %arg{2} %arg{3} %arg{4}'
		else
			echo 'line-diags-goto-buffer %arg{@}'
		fi
	}
}
# kak-lsp's lsp-show-document-symbol, less pointing the buffer's `path` at
# the project (for gf in its buffer, which the picker has no use for)
define-command -override -hidden lsp-show-document-symbol -params 4 %{
	lsp-show-goto-buffer *goto* lsp-document-symbol %arg{1} %arg{3} %arg{4}
}
# kak-lsp's lsp-show-goto-buffer (21.0.2), as it was
define-command -hidden -params 4..5 line-diags-goto-buffer %{
	evaluate-commands -save-regs '"' -try-client %opt[toolsclient] %{
		edit! -scratch %arg{1}
		set-option buffer filetype %arg{2}
		set-option buffer jump_current_line 0
		set-option buffer lsp_project_root "%arg{3}/"
		set-register '"' %arg{4}
		execute-keys Rgg
	}
	try %{
		evaluate-commands -try-client %opt[toolsclient] %{
			set-option buffer jump_current_line %arg{5}
			execute-keys %arg{5} g
		}
	}
}

# line-diags-capture ROOT LIST: keep this file's lines of the list, which
# read `path:line:column: [severity][...] message` (path from ROOT on)
define-command -hidden -params 2 line-diags-capture %{
	evaluate-commands %sh{
		double() {
			r= rest=$2
			while :; do
				case $rest in
				*"$1"*) r="$r${rest%%"$1"*}$1$1" rest=${rest#*"$1"} ;;
				*) r=$r$rest; return ;;
				esac
			done
		}
		rel=${kak_buffile#"$1"/}
		out= n=0
		while IFS= read -r l; do
			case $l in
			"$rel:"*) l=${l#"$rel:"} ;;
			"$kak_buffile:"*) l=${l#"$kak_buffile:"} ;;
			*) continue ;;
			esac
			line=${l%%:*} l=${l#*:}
			col=${l%%:*} l=${l#*: }
			case $line$col in ''|*[!0-9]*) continue ;; esac
			# [severity], then [server][source][code], none with spaces
			case $l in '[error]'*|'[warning]'*|'[info]'*|'[hint]'*) ;; *) continue ;; esac
			sev=${l#\[} sev=${sev%%]*}
			while :; do
				case $l in
				'['*']'*) g=${l%%]*}; case $g in *' '*) break ;; esac; l=${l#*]} ;;
				*) break ;;
				esac
			done
			double "'" "$line|$col|$sev|${l# }"
			out="$out '$r'" n=$((n + 1))
		done <<-EOF
			$2
		EOF
		echo "set-option buffer line_diags $out"
		echo "set-option buffer line_diags_n $n"
		echo 'line-diags-render'
	}
}

# Draw for the cursor's line, in two steps: this one picks its diagnostics
# (rightmost first) and has Kakoune measure where on screen each one's column
# is (tabs, wide characters); line-diags-draw draws.
define-command -hidden line-diags-render %{
	set-option window line_diags_seen %val{cursor_line}
	set-option window line_diags_dcols
	evaluate-commands -draft %sh{
		double() {
			r= rest=$2
			while :; do
				case $rest in
				*"$1"*) r="$r${rest%%"$1"*}$1$1" rest=${rest#*"$1"} ;;
				*) r=$r$rest; return ;;
				esac
			done
		}
		cur=$kak_cursor_line
		eval set -- "$kak_quoted_opt_inline_diagnostics_severities"
		show=" $* "
		# this line's as "column|severity|message", in col_I and e_I
		n=0
		eval set -- "$kak_quoted_opt_line_diags"
		for e; do
			[ "${e%%|*}" = "$cur" ] || continue
			e=${e#*|} sev=${e#*|} sev=${sev%%|*}
			case $show in *" $sev "*) ;; *) continue ;; esac
			# insert by column, descending
			i=$n
			while [ "$i" -gt 0 ]; do
				eval "pc=\$col_$((i - 1))"
				[ "$pc" -lt "${e%%|*}" ] || break
				eval "col_$i=\$pc e_$i=\$e_$((i - 1))"
				i=$((i - 1))
			done
			eval "col_$i=\${e%%|*} e_$i=\$e"
			n=$((n + 1))
		done
		args= i=0
		while [ "$i" -lt "$n" ]; do
			eval "c=\$col_$i e=\$e_$i"
			echo "try %{ select $cur.$c,$cur.$c; set-option -add window line_diags_dcols %val{cursor_display_column} } catch %{ set-option -add window line_diags_dcols 1 }"
			double "'" "$e"; args="$args '$r'"
			i=$((i + 1))
		done
		# the whole line: the lines below hang from its end (and its width
		# says whether it wraps)
		echo "select $cur.1,$cur.1; execute-keys x; set-option window line_diags_eolcol %val{cursor_display_column}"
		echo "line-diags-draw$args"
	}
}

# line-diags-draw COLUMN|SEVERITY|MESSAGE...: rightmost first, their screen
# columns in line_diags_dcols; the main selection is the cursor's whole line
define-command -hidden -params .. line-diags-draw %{
	evaluate-commands %sh{
		double() {
			r= rest=$2
			while :; do
				case $rest in
				*"$1"*) r="$r${rest%%"$1"*}$1$1" rest=${rest#*"$1"} ;;
				*) r=$r$rest; return ;;
				esac
			done
		}
		# subst FROM TO S: S with each FROM replaced by TO, in $r
		subst() {
			r= rest=$3
			while :; do
				case $rest in
				*"$1"*) r="$r${rest%%"$1"*}$2" rest=${rest#*"$1"} ;;
				*) r=$r$rest; return ;;
				esac
			done
		}
		# markup text (\ and the left brace escaped), then a range-specs
		# element (\ and | escaped again), in $r. (The brace comes from
		# printf: kak's parser counts the braces in this block.)
		lb=$(printf '\173')
		esc() {
			subst '\' '\\\\' "$1"; subst "$lb" '\\'"$lb" "$r"; subst '|' '\|' "$r"
		}
		cur=$kak_cursor_line n=$#
		i=0
		for e; do
			sev=${e#*|} sev=${sev%%|*}
			case $sev in
			error) f=InlayDiagnosticError ;; warning) f=InlayDiagnosticWarning ;;
			info) f=InlayDiagnosticInfo ;; *) f=InlayDiagnosticHint ;;
			esac
			eval "f_$i=\$f m_$i=\${e#*|*|}"
			i=$((i + 1))
		done
		i=0
		eval set -- "$kak_quoted_opt_line_diags_dcols"
		for d; do eval "p_$i=\$((d - 1))"; i=$((i + 1)); done

		# the end-of-line messages, less this line's if it gets lines below
		eval set -- "$kak_quoted_opt_lsp_inlay_diagnostics"
		if [ $# -eq 0 ]; then
			echo 'set-option window line_diags_eol %val{timestamp}'
		else
			eol="'$1'"; shift
			for e; do
				[ "$n" -gt 0 ] && [ "${e%%|*}" = "$cur" ] && continue
				double "'" "$e"; eol="$eol '$r'"
			done
			echo "set-option window line_diags_eol $eol"
		fi
		if [ "$n" -eq 0 ]; then
			echo 'set-option window line_diags_view %val{timestamp}'
			echo 'set-option window line_diags_drawn 0'
			exit
		fi

		# blanks to column $2 with a │ at each diagnostic left of it still to
		# come (after the $1-th), in $lead
		blanks() { while [ "$1" -gt 0 ]; do lead="$lead "; set -- $(($1 - 1)); done; }
		mklead() {
			lead= at=0 j=$((n - 1))
			while [ "$j" -gt "$1" ]; do
				eval "pj=\$p_$j fj=\$f_$j"
				if [ "$pj" -lt "$2" ] && [ "$pj" -ge "$at" ]; then
					lead="$lead{Default}"; blanks $((pj - at))
					lead="$lead{$fj}│"; at=$((pj + 1))
				fi
				j=$((j - 1))
			done
			lead="$lead{Default}"; blanks $(($2 - at))
		}
		# text width: the window less the gutter (flags, line numbers, │)
		digits=${#kak_buf_line_count}; [ "$digits" -ge 2 ] || digits=2
		width=$((kak_window_width - digits - 2))
		# a line that wraps puts its columns elsewhere on screen: then just
		# the messages, from the left
		if [ "$kak_opt_line_diags_eolcol" -gt "$width" ]; then
			i=0; while [ "$i" -lt "$n" ]; do eval "p_$i=0"; i=$((i + 1)); done
		fi
		text= i=0
		while [ "$i" -lt "$n" ]; do
			eval "p=\$p_$i f=\$f_$i m=\$m_$i"
			w=$((width - p - 2))
			[ "$w" -ge 20 ] || w=20
			first=1
			# word-wrapped to $w columns
			while [ -n "$m" ]; do
				chunk= rest=$m
				while [ -n "$rest" ]; do
					word=${rest%% *}
					case $rest in *' '*) rest=${rest#* } ;; *) rest= ;; esac
					# a word too long for a line: its first $w characters
					if [ "${#word}" -gt "$w" ]; then
						tail=$word head=
						while [ "${#head}" -lt "$w" ]; do
							head=$head${tail%"${tail#?}"} tail=${tail#?}
						done
						word=$head rest="$tail${rest:+ $rest}"
					fi
					if [ -z "$chunk" ]; then chunk=$word
					elif [ $((${#chunk} + 1 + ${#word})) -le "$w" ]; then chunk="$chunk $word"
					else rest="$word${rest:+ $rest}"; break
					fi
				done
				m=$rest
				mklead "$i" "$p"
				esc "$chunk"
				if [ -n "$first" ]; then
					text="$text
$lead{$f}└─$r"
				else
					text="$text
$lead{Default}  {$f}$r"
				fi
				first=
			done
			i=$((i + 1))
		done
		double "'" "${kak_selection_desc##*,}+0|$text"
		printf "set-option window line_diags_view %%val{timestamp} '%s'\n" "$r"
		echo 'set-option window line_diags_drawn 1'
	}
}

# Redraw when the cursor changes line. Done without a shell otherwise: a
# no-op command per unchanged line (line_diags_seen - cursor_line = 0), and
# per buffer with no diagnostics and nothing drawn.
define-command -hidden line-diags-same-0 nop
define-command -hidden line-diags-skip-0-0 nop
define-command -hidden line-diags-idle %{
	try %{
		evaluate-commands "line-diags-skip-%opt{line_diags_n}-%opt{line_diags_drawn}"
	} catch %{
		set-option -remove window line_diags_seen %val{cursor_line}
		try %{
			evaluate-commands "line-diags-same-%opt{line_diags_seen}"
			set-option window line_diags_seen %val{cursor_line}
		} catch %{
			line-diags-render
		}
	}
}
hook global NormalIdle .* line-diags-idle
hook global InsertIdle .* line-diags-idle
hook global WinDisplay .* %{ set-option window line_diags_seen 0 }

# kak-tree-sitter's text objects: <a-i>f, ]f etc. (f function, t type,
# a argument, T test), and tree navigation (Helix's A-o/A-i...) in its mode
map global user t ':enter-user-mode tree-sitter<ret>' -docstring 'tree-sitter mode'

# --- pickers for lists ---------------------------------------------------------
# kak-lsp's lists (above), ripgrep, git: in kak-picker's popup, as
# `path:line:column:text` lines (bin/kak-picker's "locations").

# picker-locations BUFNAME FILETYPE ROOT LIST: kak-lsp's goto buffer arguments
declare-option -hidden bool picker_only_this_file false
define-command -hidden -params 4 picker-locations %{
	evaluate-commands %sh{
		dir=$(mktemp -d "${TMPDIR:-/tmp}/kak-picker.XXXXXX") || exit
		echo "echo -to-file '$dir/list' %arg{4}"
		echo "echo -to-file '$dir/root' %arg{3}"
		echo "echo -to-file '$dir/type' %arg{2}"
		echo "echo -to-file '$dir/title' %arg{1}"
		if [ "$kak_opt_picker_only_this_file" = true ]; then
			echo "echo -to-file '$dir/only' %val{buffile}"
			echo 'set-option window picker_only_this_file false'
		fi
		echo "picker-open locations '$dir'"
	}
}

define-command diagnostics-picker -params ..1 -docstring 'diagnostics-picker [-workspace]: this file''s diagnostics (or every file''s) in a picker' %{
	evaluate-commands %sh{ [ "$1" = -workspace ] || echo 'set-option window picker_only_this_file true' }
	lsp-diagnostics
}
define-command symbol-picker -docstring "this file's symbols in a picker" %{
	lsp-document-symbol
}

# The workspace symbol picker asks the server as you type (kak-picker
# --wsym): each answer goes to the file named here instead.
declare-option -hidden str picker_wsym_out
define-command -hidden -params 2 picker-wsym-deliver %{
	echo -to-file "%opt{picker_wsym_out}.root" %arg{1}
	echo -to-file "%opt{picker_wsym_out}" %arg{2}
	set-option window picker_wsym_out ''
}
define-command workspace-symbol-picker -docstring 'search the workspace''s symbols (picker)' %{
	evaluate-commands %sh{
		dir=$(mktemp -d "${TMPDIR:-/tmp}/kak-picker.XXXXXX") || exit
		echo "picker-open workspace-symbols '$dir'"
	}
}

define-command global-search -docstring 'search the files under the cwd as you type (ripgrep, picker)' %{
	evaluate-commands %sh{
		dir=$(mktemp -d "${TMPDIR:-/tmp}/kak-picker.XXXXXX") || exit
		echo "picker-open grep '$dir'"
	}
}
define-command changed-file-picker -docstring 'files changed since HEAD (git, picker)' %{
	evaluate-commands %sh{
		dir=$(mktemp -d "${TMPDIR:-/tmp}/kak-picker.XXXXXX") || exit
		echo "picker-open changed '$dir'"
	}
}

map global user s ':symbol-picker<ret>'                 -docstring 'symbols (LSP)'
map global user S ':workspace-symbol-picker<ret>'       -docstring 'workspace symbols (LSP)'
map global user d ':diagnostics-picker<ret>'            -docstring 'diagnostics (LSP)'
map global user D ':diagnostics-picker -workspace<ret>' -docstring 'workspace diagnostics (LSP)'
map global user / ':global-search<ret>'                 -docstring 'global search'
map global user g ':changed-file-picker<ret>'           -docstring 'changed files (git)'

# --- git gutter ----------------------------------------------------------------
# Helix's diff gutter: lines added (▍ green), changed (▍ yellow) and removed
# (▔ red, on the line after) since HEAD, for the buffer as it is, unsaved
# changes and all; ]g [g move between them. (Kakoune's git.kak has the like,
# but against the index, and needs diff(1).) Worked out in the background
# whenever the buffer has changed by the time keys stop, and on save and
# focus (a commit moves HEAD), so typing never waits on git.

# buffer: whether it's a file in HEAD ('' not known yet, yes, no), its
# repository and path there, and the timestamp the flags are for
declare-option -hidden str git_gutter_state
declare-option -hidden str git_gutter_root
declare-option -hidden str git_gutter_path
declare-option -hidden int git_gutter_seen -1

# (checks without a shell: these exist for the states they accept)
define-command -hidden git-gutter-known-yes nop
define-command -hidden git-gutter-known-no nop
define-command -hidden git-gutter-on-yes nop

define-command -hidden git-gutter-locate %{
	evaluate-commands %sh{
		root=
		case $kak_buffile in
		/*) root=$(git -C "${kak_buffile%/*}" rev-parse --show-toplevel 2>/dev/null) ;;
		esac
		path=${kak_buffile#"$root"/}
		# not in git, or not in HEAD (new): nothing to diff against
		if [ -z "$root" ] || ! git -C "$root" cat-file -e "HEAD:./$path" 2>/dev/null; then
			echo 'set-option buffer git_gutter_state no; set-option buffer git_gutter_flags 0'
			exit
		fi
		printf "set-option buffer git_gutter_root '%s'\n" "$(printf %s "$root" | sed "s/'/''/g")"
		printf "set-option buffer git_gutter_path '%s'\n" "$(printf %s "$path" | sed "s/'/''/g")"
		echo 'set-option buffer git_gutter_state yes'
	}
}

define-command -hidden git-gutter-update %{
	try %{ evaluate-commands "git-gutter-known-%opt{git_gutter_state}" } catch %{ git-gutter-locate }
	try %{
		evaluate-commands "git-gutter-on-%opt{git_gutter_state}"
		git-gutter-run
	}
}

define-command -hidden git-gutter-run %{
	set-option buffer git_gutter_seen %val{timestamp}
	evaluate-commands %sh{
		dir=${TMPDIR:-/tmp}/kak-git-gutter-$kak_session
		mkdir -p "$dir" || exit
		# one file per buffer; the buffer goes there now, the diff runs after
		f=$dir/$(printf %s "$kak_buffile" | cksum | cut -d' ' -f1)
		printf "evaluate-commands -no-hooks write -force '%s'\n" "$f.buf"
		printf "git-gutter-diff '%s' %s\n" "$f" "$kak_timestamp"
	}
}
define-command -hidden -params 2 git-gutter-diff %{
	nop %sh{
		(
			f=$1 ts=$2
			cd "$kak_opt_git_gutter_root" || exit
			git show "HEAD:./$kak_opt_git_gutter_path" > "$f.base" 2>/dev/null || exit
			flags=$(git diff --no-index --no-color -U0 -- "$f.base" "$f.buf" | awk '
				/^@@/ {
					split($2, a, ","); split($3, b, ",")
					from = a[2] == "" ? 1 : a[2]; to_line = substr(b[1], 2) + 0
					to = b[2] == "" ? 1 : b[2]
					if (to == 0) { l = to_line + 1; printf " %d|{GitGutterDelete}▔", l < 1 ? 1 : l; next }
					for (i = 0; i < to; i++)
						printf " %d|{%s}▍", to_line + i, i < from ? "GitGutterModify" : "GitGutterAdd"
				}')
			b=$(printf %s "$kak_buffile" | sed "s/'/''/g")
			printf "evaluate-commands -buffer '%s' %%{ set-option buffer git_gutter_flags %s%s }\n" "$b" "$ts" "$flags" |
				kak -p "$kak_session"
		) >/dev/null 2>&1 </dev/null &
	}
}

# per buffer when keys stop, if it changed since (no shell otherwise: the
# timestamp check is a no-op command when they're equal)
define-command -hidden git-gutter-same-0 nop
define-command -hidden git-gutter-idle %{
	try %{
		evaluate-commands "git-gutter-on-%opt{git_gutter_state}"
		set-option -remove buffer git_gutter_seen %val{timestamp}
		try %{
			evaluate-commands "git-gutter-same-%opt{git_gutter_seen}"
			set-option buffer git_gutter_seen %val{timestamp}
		} catch %{
			git-gutter-run
		}
	}
}
hook global NormalIdle .* git-gutter-idle
hook global InsertIdle .* git-gutter-idle
hook global WinDisplay .* git-gutter-update
# saved (it may be new to git no more), or back from elsewhere (a commit)
hook global BufWritePost .* %{ set-option buffer git_gutter_state ''; git-gutter-update }
hook global FocusIn .* %{ set-option buffer git_gutter_state ''; git-gutter-update }

# ]g [g: the next / previous change, from object mode (like ]d [d)
define-command -hidden git-hunk-object %{
	evaluate-commands %sh{
		case $kak_object_flags in *to_begin*) dir=prev ;; *) dir=next ;; esac
		eval set -- "$kak_quoted_opt_git_gutter_flags"
		shift
		# hunks: runs of consecutive lines, as start-end
		cur=$kak_cursor_line best= start= prev=
		for e in "$@" ''; do
			l=${e%%|*}
			if [ -n "$start" ] && { [ -z "$l" ] || [ "$l" -ne $((prev + 1)) ]; }; then
				if [ "$dir" = next ] && [ "$start" -gt "$cur" ]; then
					echo "select $start.1,$prev.1; execute-keys x"; exit
				fi
				[ "$dir" = prev ] && [ "$prev" -lt "$cur" ] && best="$start.1,$prev.1"
				start=
			fi
			[ -n "$l" ] || break
			[ -n "$start" ] || start=$l
			prev=$l
		done
		if [ -n "$best" ]; then echo "select $best; execute-keys x"; else echo "fail 'no more changes'"; fi
	}
}
map global object g '<a-;>git-hunk-object<ret>' -docstring 'git change'

# --- match mode: brackets, surrounds ------------------------------------------
# Helix's m: mm to the matching bracket (Kakoune's m; M, extending, is left
# as it is), mi/ma select inside/around an object (<a-i>/<a-a>), and the
# surrounds: ms( wraps the selections in ( ), mr([ turns the ( ) around them
# into [ ], md( deletes them. A bracket and its closer are the same pair;
# any other character pairs with itself.
declare-user-mode match
map global normal m ':enter-user-mode match<ret>' -docstring 'match mode'
map global match m m                       -docstring 'goto matching bracket'
map global match i <a-i>                   -docstring 'select inside object'
map global match a <a-a>                   -docstring 'select around object'
map global match s ':surround-add<ret>'     -docstring 'surround add'
map global match r ':surround-replace<ret>' -docstring 'surround replace'
map global match d ':surround-delete<ret>'  -docstring 'surround delete'

# surround-char KEY: KEY (as on-key names it) to the character, in $k
# (a shell function, prepended to the scripts below)
declare-option -hidden str surround_sh %{
	surround_char() {
		case $1 in
		'<esc>') exit ;;
		'<lt>') k='<' ;; '<gt>') k='>' ;; '<space>') k=' ' ;; '<minus>') k=- ;;
		'<plus>') k=+ ;; '<semicolon>') k=';' ;; '<percent>') k=% ;;
		'<dquote>') k='"' ;; '<quote>') k="'" ;; '<backtick>') k='`' ;;
		'<backslash>') k='\' ;; '<pipe>') k='|' ;;
		'<'?*) echo "fail 'surround: not a character: $1'"; exit ;;
		*) k=$1 ;;
		esac
		# (the braces from printf: kak's parser counts those in this block)
		lb=$(printf '\173') rb=$(printf '\175')
		case $k in
		'('|')') o='(' c=')' obj='(' ;;
		'['|']') o='[' c=']' obj='[' ;;
		"$lb"|"$rb") o=$lb c=$rb obj=$lb ;;
		'<'|'>') o='<' c='>' obj='<lt>' ;;
		'"'|"'"|'`') o=$k c=$k obj=$k ;;
		# any other: a custom object, the character on each side
		*) o=$k c=$k
		   e=$k; case $e in '<') e='<lt>' ;; [][\\.*+?^$\|\(\)]) e="\\$e" ;; esac
		   obj="c$e,$e<ret>" ;;
		esac
	}
	kq() { printf "'%s'" "$(printf %s "$1" | sed "s/'/''/g")"; }
}

define-command -hidden surround-add %{
	on-key -mode-name surround %{ evaluate-commands %sh{
		eval "$kak_opt_surround_sh"; surround_char "$kak_key"
		echo "surround-insert $(kq "$o") $(kq "$c")"
	} }
}
define-command -hidden -params 2 surround-insert %{
	evaluate-commands -save-regs oc %{
		set-register o %arg{1}
		set-register c %arg{2}
		# then the selections take in the opener too, so they cover the pair
		execute-keys 'i<c-r>o<esc>a<c-r>c<esc><a-;>H<a-;>'
	}
}
define-command -hidden surround-delete %{
	on-key -mode-name surround %{ evaluate-commands %sh{
		eval "$kak_opt_surround_sh"; surround_char "$kak_key"
		# around it, its first and last characters, gone
		echo "execute-keys $(kq "<a-a>$obj<a-S>d")"
	} }
}
define-command -hidden surround-replace %{
	on-key -mode-name surround %{ evaluate-commands %sh{
		eval "$kak_opt_surround_sh"; surround_char "$kak_key"
		echo "execute-keys $(kq "<a-a>$obj<a-S>")"
		echo 'surround-replace-with'
	} }
}
# the selections are the old pairs' characters, opener then closer
define-command -hidden surround-replace-with %{
	on-key -mode-name surround %{ evaluate-commands %sh{
		eval "$kak_opt_surround_sh"; surround_char "$kak_key"
		pairs= i=0
		while [ "$i" -lt "$kak_selection_count" ]; do
			pairs="$pairs $(kq "$o") $(kq "$c")"; i=$((i + 2))
		done
		echo "surround-put$pairs"
	} }
}
# surround-put CHARACTER...: one per selection, in their place
define-command -hidden -params .. surround-put %{
	evaluate-commands -save-regs o %{
		set-register o %arg{@}
		execute-keys '"oR'
	}
}

# --- comments ----------------------------------------------------------------
# Helix's <space>c / <space>C: toggle line / block comments, with the comment
# tokens Kakoune's filetype scripts set (comment_line, comment_block_*).
# Helix's C-c can't be had: Kakoune keeps <c-c> for interrupting shells.
map global user c ':comment-line<ret>'  -docstring 'toggle line comments'
map global user C ':comment-block<ret>' -docstring 'toggle block comments'

# --- system clipboard ----------------------------------------------------------
# Helix's <space>y/Y/p/P/R. The clipboard is Windows' under WSL (win32yank),
# Wayland's, or X's.
declare-option -hidden str clipboard_copy
declare-option -hidden str clipboard_paste
evaluate-commands %sh{
	if command -v win32yank.exe >/dev/null; then
		copy='win32yank.exe -i --crlf' paste='win32yank.exe -o --lf'
	elif [ -n "$WAYLAND_DISPLAY" ] && command -v wl-copy >/dev/null; then
		copy='wl-copy' paste='wl-paste --no-newline'
	elif command -v xclip >/dev/null; then
		copy='xclip -selection clipboard -i' paste='xclip -selection clipboard -o'
	else
		exit
	fi
	echo "set-option global clipboard_copy '$copy'"
	echo "set-option global clipboard_paste '$paste'"
}
# clipboard-yank [-main]: the selections, one per line (or just the main one)
define-command -hidden -params ..1 clipboard-yank %{
	evaluate-commands %sh{
		[ -n "$kak_opt_clipboard_copy" ] || { echo "fail 'clipboard: no clipboard tool'"; exit; }
		if [ "$1" = -main ]; then
			printf %s "$kak_selection" | eval "$kak_opt_clipboard_copy" >/dev/null 2>&1
			n=1
		else
			eval set -- "$kak_quoted_selections"
			n=$# all= sep=
			for s; do all="$all$sep$s" sep='
'; done
			printf %s "$all" | eval "$kak_opt_clipboard_copy" >/dev/null 2>&1
		fi
		echo "echo -markup '{Information}yanked $n selection(s) to the clipboard'"
	}
}
# clipboard-paste KEYS: KEYS (p, P or R) with the clipboard as the register.
# (%sh{} drops one final newline, hence the echo: a copied line stays one.)
define-command -hidden -params 1 clipboard-paste %{
	evaluate-commands -save-regs c %{
		set-register c %sh{ eval "$kak_opt_clipboard_paste" 2>/dev/null; echo }
		execute-keys """c%arg{1}"
	}
}
map global user y ':clipboard-yank<ret>'       -docstring 'yank selections to clipboard'
map global user Y ':clipboard-yank -main<ret>' -docstring 'yank main selection to clipboard'
map global user p ':clipboard-paste p<ret>'    -docstring 'paste clipboard after'
map global user P ':clipboard-paste P<ret>'    -docstring 'paste clipboard before'
map global user R ':clipboard-paste R<ret>'    -docstring 'replace selections with clipboard'

# --- [keys] ------------------------------------------------------------------
# Kakoune has no select mode: the extending form of a motion is its shift
# variant, so [keys.select] folds into these. Helix's move_prev_word_end has no
# Kakoune motion; C-left goes to the previous word start (b) instead.

map global normal <c-right> w
map global normal <c-left>  b
map global normal <s-right> L
map global normal <s-left>  H

# Insert mode: <a-;> runs one normal-mode command. Typing in insert mode goes
# before the selection rather than replacing it, so S-left/S-right only
# matter once you leave insert mode.
map global insert <c-right> '<a-;>w<a-;>l'
map global insert <c-left>  '<a-;>b<a-;>;'
map global insert <s-right> '<a-;>L'
map global insert <s-left>  '<a-;>H'

# --- bufferline (tmux) --------------------------------------------------------
# Kakoune can't draw a bufferline itself, so each client publishes its buffer
# list to its tmux pane as @kak_bufferline, which kakmux.conf draws as the
# status line. Like bufferline = "multiple", it only shows with 2+ buffers.
# Only under kakmux: in any other tmux the status line is the user's own.

declare-option -hidden str-list bufferline_bufs
# last "pane|line" sent, to skip the tmux call when nothing changed
declare-option -hidden str bufferline_last

# Colours: the faces BufferLineActive and BufferLineInactive (which also fills
# the rest of the line), or for colour schemes without them, MenuForeground
# (as the pickers' selected row) and StatusLine. Turned into tmux styles once
# per colour scheme, from the faces dump (see pickers below).
declare-option -hidden str bufferline_active
declare-option -hidden str bufferline_inactive

define-command -hidden bufferline-load-styles %{
	faces-load
	evaluate-commands %sh{
		# All in the shell, no other processes. A dump line reads
		# ` * Name: fg,bg,underline[+attrs]`, the last one for a face counting;
		# references to other faces show as default, as if unset.
		while IFS= read -r l; do
			case $l in
			' * BufferLineActive: '*|' * BufferLineInactive: '*|' * MenuForeground: '*|' * StatusLine: '*)
				n=${l#' * '}; eval "face_${n%%: *}=\${n#*: }" ;;
			esac
		done <<-EOF
			$kak_opt_faces_cache
		EOF
		# kak colour -> tmux colour, in $v
		col() {
			case $1 in
			rgb:*) v="#${1#rgb:}" ;;
			rgba:*) v=${1#rgba:}; v="#${v%??}" ;;
			bright-*) v="bright${1#bright-}" ;;
			*) v=$1 ;;
			esac
		}
		# style FACE FALLBACK: FACE's tmux style, or FALLBACK's if FACE is
		# unset, in $s
		style() {
			eval "spec=\${face_$1:-}"
			case $spec in ''|default,default,default) eval "spec=\${face_$2:-}" ;; esac
			[ -n "$spec" ] || spec=default,default,default
			fg=${spec%%,*} rest=${spec#*,}
			bg=${rest%%,*} rest=${rest#*,}
			ul=${rest%%+*} attrs=
			case $rest in *+*) attrs=${rest#*+} ;; esac
			col "$fg"; s="fg=$v"; col "$bg"; s="$s,bg=$v"
			while [ -n "$attrs" ]; do
				a=${attrs%"${attrs#?}"} attrs=${attrs#?}
				case $a in
				u) s="$s,underscore" ;; c) s="$s,curly-underscore" ;; U) s="$s,double-underscore" ;;
				b) s="$s,bold" ;; i) s="$s,italics" ;; d) s="$s,dim" ;; r) s="$s,reverse" ;;
				s) s="$s,strikethrough" ;; B) s="$s,blink" ;;
				esac
			done
			[ "$ul" = default ] || { col "$ul"; s="$s,us=$v"; }
		}
		style BufferLineActive MenuForeground
		printf "set-option global bufferline_active '%s'\n" "$s"
		style BufferLineInactive StatusLine
		printf "set-option global bufferline_inactive '%s'\n" "$s"
	}
}

define-command -hidden bufferline-refresh %{
	set-option global bufferline_bufs
	evaluate-commands -buffer * %{
		set-option -add global bufferline_bufs "%val{modified}:%val{bufname}"
	}
	evaluate-commands %sh{
		case ${kak_client_env_TMUX%%,*} in */kakmux-*) ;; *) exit 0 ;; esac
		[ -n "$kak_client_env_TMUX_PANE" ] || exit 0
		if [ -z "$kak_opt_bufferline_active" ]; then
			echo 'bufferline-load-styles; bufferline-refresh'; exit 0
		fi
		# double C in S, in $r (all in the shell: this runs whenever keys stop)
		double() {
			r= rest=$2
			while :; do
				case $rest in
				*"$1"*) r="$r${rest%%"$1"*}$1$1" rest=${rest#*"$1"} ;;
				*) r=$r$rest; return ;;
				esac
			done
		}
		eval set -- "$kak_quoted_opt_bufferline_bufs"
		line=
		for e; do
			name=${e#*:} label=${e#*:}
			label=${label##*/}
			[ "${e%%:*}" = true ] && label="$label[+]"
			case $label in *'#'*) double '#' "$label"; label=$r ;; esac
			if [ "$name" = "$kak_bufname" ]; then
				line="$line#[$kak_opt_bufferline_active] $label #[default]"
			else
				line="$line#[$kak_opt_bufferline_inactive] $label "
			fi
		done
		[ $# -gt 1 ] || line=
		[ "$kak_client_env_TMUX_PANE|$line" = "$kak_opt_bufferline_last" ] && exit 0
		export TMUX="$kak_client_env_TMUX"
		status=off; [ -n "$line" ] && status=on
		tmux set-option -p -t "$kak_client_env_TMUX_PANE" @kak_bufferline "$line" \; \
			set-option -t "$kak_client_env_TMUX_PANE" status-style "$kak_opt_bufferline_inactive" \; \
			set-option -t "$kak_client_env_TMUX_PANE" status "$status" \
			>/dev/null 2>&1
		double "'" "$kak_client_env_TMUX_PANE|$line"
		printf "set-option global bufferline_last '%s'\n" "$r"
	}
}

# Idle hooks catch every change (new/closed buffer, switch, first edit, save)
# once keys stop; FocusIn catches changes another client made. Only kakmux
# clients' windows get them, so no other client starts a shell whenever keys
# stop.
hook global WinDisplay .* %{
	evaluate-commands %sh{
		case ${kak_client_env_TMUX%%,*} in */kakmux-*) ;; *) exit ;; esac
		echo 'remove-hooks window bufferline'
		echo 'hook -group bufferline window NormalIdle .* bufferline-refresh'
		echo 'hook -group bufferline window InsertIdle .* bufferline-refresh'
		echo 'hook -group bufferline window FocusIn    .* bufferline-refresh'
	}
}

# :kakmux moves this client into a kakmux: it opens a client on the same session
# in a new, detached kakmux (its own tmux server, as each kakmux has), which
# quits this one once connected (quitting first could take the server down
# with the last client). kak (the .zshrc wrapper that set KAKMUX_HANDOFF) then
# attaches it in this terminal, or inside another tmux, nested in this pane
# (see ~/.local/bin/kakmux).
define-command kakmux -docstring 'continue this session inside kakmux (tmux bufferline)' %{
	evaluate-commands %sh{
		case ${kak_client_env_TMUX%%,*} in */kakmux-*)
			echo "fail 'kakmux: already inside kakmux'"; exit ;;
		esac
		server=kakmux-$$
		buf=$(printf %s "$kak_bufname" | sed "s/'/''/g")
		init="buffer '$buf'; select $kak_selections_desc"
		if [ -n "$kak_client_env_KAKMUX_HANDOFF" ]; then
			printf %s "$server" > "$kak_client_env_KAKMUX_HANDOFF"
			init="$init; evaluate-commands -client $kak_client quit"
		fi
		TMUX= tmux -L "$server" -f ~/.config/kak/kakmux.conf new-session -d -- \
			kak -c "$kak_session" -e "$init" \
			|| { echo "fail 'kakmux: tmux failed'"; exit; }
		# nested: at its edges, <c-w> moves on to this pane's neighbours
		[ -z "$kak_client_env_TMUX" ] ||
			TMUX= tmux -L "$server" set-option @outer_pane \
				"${kak_client_env_TMUX%%,*} $kak_client_env_TMUX_PANE" >/dev/null 2>&1
		[ -n "$kak_client_env_KAKMUX_HANDOFF" ] ||
			echo "echo -markup '{Information}not started via the kak wrapper; run: TMUX= tmux -L $server attach'"
	}
}

# --- pickers (<space>b buffers, <space>f files) ------------------------------
# Helix-style fuzzy pickers in a tmux popup (so kakmux, or any tmux), coloured
# from the current colour scheme's menu faces. bin/kak-picker does the fzf and
# the actions; its legend lists the keys. picker-open hands it a temp dir
# holding the faces (and whatever else the picker kind needs).

# bat theme for the previews (bat can't follow kak's colour scheme)
declare-option str picker_bat_theme TwoDark

# :debug faces is the only way to read the faces' colours (the pickers' and
# the bufferline's). It appends to *debug* (which can't be edited, so dumps
# can't be cleaned up), so dump once and cache it, and only again after
# :colorscheme, which an alias wraps to drop the cache (and reset the faces
# that only some schemes set).
# It lists the faces of the scope it runs in; for a client that's its
# (usually empty) window scope, so it runs in *debug*'s buffer context.
declare-option -hidden str faces_cache

define-command -hidden faces-load %{
	evaluate-commands %sh{
		[ -n "$kak_opt_faces_cache" ] ||
			echo "evaluate-commands -buffer *debug* %{ debug faces; execute-keys 'ge<a-?>^Faces:<ret>'; set-option global faces_cache %val{selection} }"
	}
}

define-command -hidden -params 1 picker-colorscheme %{
	set-option global faces_cache ''
	set-option global bufferline_active ''
	# for schemes without them (default: the bufferline's fallbacks)
	evaluate-commands %opt{plugin_faces}
	set-face global StatusLineInactive '+d@StatusLine'
	set-face global BufferLineActive default
	set-face global BufferLineInactive default
	unalias global colorscheme picker-colorscheme
	try %{
		colorscheme %arg{1}
	} catch %{
		alias global colorscheme picker-colorscheme
		fail %val{error}
	}
	alias global colorscheme picker-colorscheme
}
complete-command picker-colorscheme shell-script-candidates %{
	find -L "${kak_runtime}/colors" "${kak_config}/colors" -type f -name '*.kak' \
		| sed 's|.*/||; s|\.kak$||' | sort -u
}
alias global colorscheme picker-colorscheme

declare-option -hidden str-list buffer_mru
hook global WinDisplay .* %{
	set-option -remove global buffer_mru %val{bufname}
	set-option -add global buffer_mru %val{bufname}
}

# where each buffer's cursor last was: evaluate-commands -buffer, which the
# buffer picker reads buffers with, always starts at line 1
declare-option -hidden int picker_line 1
hook global NormalIdle .* %{ set-option buffer picker_line %val{cursor_line} }

# clients with a picker popup open: the popup takes the focus, but that isn't
# leaving the editor (no auto-save, no dimmed status line). Until FocusIn.
declare-option -hidden str-list picker_clients
hook global FocusIn     .* %{ set-option -remove global picker_clients %val{client} }
hook global ClientClose .* %{ set-option -remove global picker_clients %val{hook_param} }

# picker-open KIND DIR
define-command -hidden -params 2 picker-open %{
	evaluate-commands %sh{
		[ -n "$kak_client_env_TMUX" ] && exit
		rm -rf -- "${2:?}"
		echo "fail 'picker: needs tmux (:kakmux)'"
	}
	faces-load
	echo -to-file "%arg{2}/faces" %opt{faces_cache}
	set-option -remove global picker_clients %val{client}
	set-option -add global picker_clients %val{client}
	nop %sh{
		{
			TMUX="$kak_client_env_TMUX" tmux display-popup -t "$kak_client_env_TMUX_PANE" \
				-d "$PWD" -e "BAT_THEME=$kak_opt_picker_bat_theme" -E -B -w 90% -h 80% -- \
				~/.config/kak/bin/kak-picker "$1" "${2:?}" "$kak_session" "$kak_client" "$kak_client_env_TMUX_PANE" \
				|| {
					rm -rf -- "${2:?}"
					printf "set-option -remove global picker_clients '%s'\n" "$(printf %s "$kak_client" | sed "s/'/''/g")" |
						kak -p "$kak_session"
				}
		} >/dev/null 2>&1 </dev/null &
	}
}

define-command buffer-picker -docstring 'fuzzy-pick a buffer (tmux popup)' %{
	evaluate-commands %sh{
		dir=$(mktemp -d "${TMPDIR:-/tmp}/kak-picker.XXXXXX") || exit
		# most recent first, then any buffer never displayed yet
		{
			eval "set -- $kak_quoted_opt_buffer_mru"
			for b; do printf '%s\n' "$b"; done | tac
			eval "set -- $kak_quoted_buflist"
			for b; do printf '%s\n' "$b"; done
		} | awk '!seen[$0]++' > "${dir:?}/order"
		n=0
		while IFS= read -r b; do
			# skip names gone from the buflist (closed buffers left in the MRU)
			eval "set -- $kak_quoted_buflist"
			found=; for x; do [ "$x" = "$b" ] && found=1 && break; done
			[ -n "$found" ] && [ "$b" != '*debug*' ] || continue
			printf %s "$b" > "${dir:?}/${n:?}.name"
			# -buffer takes a comma-separated list: escape \ and , in the name
			q=$(printf %s "$b" | sed 's/\\/\\\\/g; s/,/\\,/g' | sed "s/'/''/g")
			printf "evaluate-commands -buffer '%s' %%{ echo -to-file '%s' %%opt{picker_line} %%val{modified}; execute-keys '%%'; echo -to-file '%s' %%val{selection} }\n" \
				"$q" "${dir:?}/${n:?}.meta" "${dir:?}/${n:?}"
			n=$((n + 1))
		done < "${dir:?}/order"
		rm -f -- "${dir:?}/order"
		echo "picker-open buffers '${dir:?}'"
	}
}

define-command file-picker -docstring "fuzzy-pick a file under kak's cwd (tmux popup)" %{
	evaluate-commands %sh{
		dir=$(mktemp -d "${TMPDIR:-/tmp}/kak-picker.XXXXXX") || exit
		echo "picker-open files '${dir:?}'"
	}
}

map global user b ':buffer-picker<ret>' -docstring 'buffer picker'
map global user f ':file-picker<ret>'   -docstring 'file picker'

# --- splits (tmux) ------------------------------------------------------------
# A split is a tmux pane running another client of this session, so all
# splits share buffers. Helix's :vsplit/:hsplit and <c-w> (also <space>w)
# window mode; tmux's own prefix keys work on the same panes too.

# Splits are weighted (bin/kakmux-even, run by kakmux.conf's tmux hooks,
# for tmux's own split keys too): opening or closing one shares out the
# row/column it's in by weight, members that are split themselves scaling
# as a whole. A new split gets the weights of the one it came from, so plain
# splits stay even (a second :vs makes thirds); :vs/:hs R makes the original
# R% and the new one (100 - R)% of the pair. :weight reads/sets weights.

# split-with -h|-v INIT [RATIO]: new client in a split, running kak commands INIT
define-command -hidden -params 2..3 split-with %{
	evaluate-commands %sh{
		if [ -z "$kak_client_env_TMUX" ]; then
			echo "fail 'split: needs tmux (:kakmux)'"; exit
		fi
		export TMUX="$kak_client_env_TMUX"
		[ -n "$3" ] && tmux set-option -w -t "$kak_client_env_TMUX_PANE" @kakmux_ratio "$3"
		tmux split-window "$1" -t "$kak_client_env_TMUX_PANE" -- \
			kak -c "$kak_session" -e "$2" >/dev/null 2>&1 || {
			tmux set-option -wu -t "$kak_client_env_TMUX_PANE" @kakmux_ratio
			echo "fail 'split: tmux split-window failed'"
		}
	}
}
define-command -hidden splits-even %{
	nop %sh{ ~/.config/kak/bin/kakmux-even "${kak_client_env_TMUX%%,*}" "$kak_client_env_TMUX_PANE" all >/dev/null 2>&1 }
}
# split-impl -h|-v [RATIO] [FILE]
define-command -hidden -params 1..3 split-impl %{
	evaluate-commands %sh{
		kq() { printf "'%s'" "$(printf %s "$1" | sed "s/'/''/g")"; }
		dir=$1; shift
		ratio=
		case $1 in
		[1-9]|[1-9][0-9]) ratio=$1; shift ;;
		*[!0-9]*|'') ;;
		*) echo "fail 'split: ratio must be 1 to 99'"; exit ;;
		esac
		if [ $# -ge 1 ]; then
			init="edit $(kq "$1")"
		else
			init="buffer $(kq "$kak_bufname"); select $kak_selections_desc"
		fi
		echo "split-with $dir $(kq "$init") $ratio"
	}
}
define-command vsplit -params ..2 -docstring 'vsplit [<ratio>] [<file>]: split side by side, this one <ratio>% (1-99) of the pair' %{ split-impl -h %arg{@} }
define-command hsplit -params ..2 -docstring 'hsplit [<ratio>] [<file>]: split stacked, this one <ratio>% (1-99) of the pair' %{ split-impl -v %arg{@} }
complete-command vsplit file
complete-command hsplit file
alias global vs vsplit
alias global hs hsplit

define-command weight -params ..2 -docstring 'weight [-width|-height] [<w>]: set this split''s share of the row/column it''s directly in, or with -width (-height), the share of the part holding it in the next row (column) out; without <w>, show those' %{
	evaluate-commands %sh{
		if [ -z "$kak_client_env_TMUX" ]; then
			echo "fail 'weight: needs tmux (:kakmux)'"; exit
		fi
		axis=-
		case $1 in -width) axis=h; shift ;; -height) axis=v; shift ;; esac
		case $1 in
		'') ;;
		*[!0-9.]*|.|*.*.*) echo "fail 'weight: not a positive number: $1'"; exit ;;
		*) awk -v w="$1" 'BEGIN { exit !(w > 0) }' || { echo "fail 'weight: not a positive number: $1'"; exit; } ;;
		esac
		out=$(~/.config/kak/bin/kakmux-even "${kak_client_env_TMUX%%,*}" "$kak_client_env_TMUX_PANE" weight "$axis" "$1")
		[ -n "$1" ] || {
			set -- $out
			echo "echo 'weight: $1 here · -width $2 · -height $3'"
		}
	}
}

# close every other split; with one left, the weights only name panes gone
define-command -hidden split-only %{
	nop %sh{
		export TMUX="$kak_client_env_TMUX"
		tmux kill-pane -a -t "$kak_client_env_TMUX_PANE" \; \
			set-option -wu -t "$kak_client_env_TMUX_PANE" @kakmux_weights >/dev/null 2>&1
	}
}

define-command -hidden -params 1.. tmux-here %{
	nop %sh{ TMUX="$kak_client_env_TMUX" tmux "$@" >/dev/null 2>&1 }
}
# split-focus -L|-R|-U|-D: unlike tmux, don't wrap around at the edges. At
# one, a tmux nested in another (kakmux, :kakmux) moves on there, by the same
# rule: its session option @outer_pane holds the other's socket and the pane
# it runs in, and that tmux's session may have one in turn.
define-command -hidden -params 1 split-focus %{
	nop %sh{
		case $1 in -L) edge=left ;; -R) edge=right ;; -U) edge=top ;; -D) edge=bottom ;; esac
		socket=${kak_client_env_TMUX%%,*} pane=$kak_client_env_TMUX_PANE
		while [ -n "$socket" ] && [ -n "$pane" ]; do
			if [ "$(tmux -S "$socket" display-message -p -t "$pane" "#{pane_at_$edge}" 2>/dev/null)" != 1 ]; then
				tmux -S "$socket" select-pane "$1" -t "$pane" >/dev/null 2>&1
				exit
			fi
			outer=$(tmux -S "$socket" show-options -qv -t "$pane" @outer_pane 2>/dev/null)
			socket=${outer%% *} pane=${outer#* }
		done
	}
}

# Each client labels its tmux pane with @kak_session and @kak_client, so tools
# outside kak can reach the client in a pane (broot-open opens files there).
define-command -hidden pane-label %{
	nop %sh{
		[ -n "$kak_client_env_TMUX_PANE" ] || exit
		TMUX="$kak_client_env_TMUX" tmux \
			set-option -p -t "$kak_client_env_TMUX_PANE" @kak_session "$kak_session" \; \
			set-option -p -t "$kak_client_env_TMUX_PANE" @kak_client "$kak_client" >/dev/null 2>&1
	}
}
hook global ClientCreate  .* pane-label
hook global ClientRenamed .* pane-label

# run-in-focused-client CMD: run kak commands CMD in the client focused last
# (else any), for tools outside kak that only know its session: broot-open
# opens files that way
declare-option -hidden str focused_client
hook global ClientCreate .* %{ set-option global focused_client %val{client} }
hook global FocusIn      .* %{ set-option global focused_client %val{client} }
define-command -hidden -params 1 run-in-focused-client %{
	evaluate-commands %sh{
		eval set -- "$kak_quoted_client_list"
		target=$1
		for c; do [ "$c" = "$kak_opt_focused_client" ] && target=$c; done
		[ -n "$target" ] || exit
		printf "evaluate-commands -client '%s' %%arg{1}\n" "$(printf %s "$target" | sed "s/'/''/g")"
	}
}

declare-user-mode window
map global window v ':vsplit<ret>'                         -docstring 'split side by side'
map global window s ':hsplit<ret>'                         -docstring 'split stacked'
map global window h ':split-focus -L<ret>'                 -docstring 'focus left'
map global window j ':split-focus -D<ret>'                 -docstring 'focus down'
map global window k ':split-focus -U<ret>'                 -docstring 'focus up'
map global window l ':split-focus -R<ret>'                 -docstring 'focus right'
map global window <left>  ':split-focus -L<ret>'           -docstring 'focus left'
map global window <down>  ':split-focus -D<ret>'           -docstring 'focus down'
map global window <up>    ':split-focus -U<ret>'           -docstring 'focus up'
map global window <right> ':split-focus -R<ret>'           -docstring 'focus right'
map global window w ':tmux-here select-pane -t :.+<ret>'   -docstring 'next split'
map global window q ':quit<ret>'                           -docstring 'close this split'
map global window o ':split-only<ret>'                     -docstring 'close other splits'
map global window z ':tmux-here resize-pane -Z -t %val{client_env_TMUX_PANE}<ret>' -docstring 'zoom this split (toggle)'
map global window = ':splits-even<ret>'                     -docstring 'even out all splits'
map global normal <c-w> ':enter-user-mode window<ret>'
map global user   w     ':enter-user-mode window<ret>'     -docstring 'window mode'

# Helix's gn/gp: next/previous buffer
map global goto n '<esc>:buffer-next<ret>'     -docstring 'next buffer'
map global goto p '<esc>:buffer-previous<ret>' -docstring 'previous buffer'

# --- languages.toml ----------------------------------------------------------
# indent = { tab-width = 4, unit = "\t" }; indentwidth 0 means indent with tabs.
# Helix's "bash" is Kakoune's "sh".
hook global WinSetOption filetype=(c|cpp|sh|markdown) %{
	set-option window tabstop 4
	set-option window indentwidth 0
	hook -once -always window WinSetOption filetype=.* %{
		unset-option window tabstop
		unset-option window indentwidth
	}
}
