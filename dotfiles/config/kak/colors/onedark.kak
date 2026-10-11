# One Dark, after Helix's onedark theme.

evaluate-commands %{
	declare-option -hidden str red     'rgb:E06C75'
	declare-option -hidden str green   'rgb:98C379'
	declare-option -hidden str yellow  'rgb:E5C07B'
	declare-option -hidden str blue    'rgb:61AFEF'
	declare-option -hidden str purple  'rgb:C678DD'
	declare-option -hidden str cyan    'rgb:56B6C2'
	declare-option -hidden str gold    'rgb:D19A66'
	declare-option -hidden str white   'rgb:ABB2BF'
	declare-option -hidden str black   'rgb:282C34'
	declare-option -hidden str lblack  'rgb:2C323C'
	declare-option -hidden str gray    'rgb:3E4452'
	declare-option -hidden str lgray   'rgb:5C6370'
	declare-option -hidden str linenr  'rgb:4B5263'
}

# code
set-face global value         "%opt{gold}"
set-face global type          "%opt{yellow}"
set-face global variable      "%opt{red}"
set-face global module        "%opt{yellow}"
set-face global function      "%opt{blue}"
set-face global string        "%opt{green}"
set-face global keyword       "%opt{purple}"
set-face global operator      "%opt{purple}"
set-face global attribute     "%opt{yellow}"
set-face global comment       "%opt{lgray}+i"
set-face global documentation comment
set-face global meta          "%opt{red}"
set-face global builtin       "%opt{gold}"

# markup
set-face global title  "%opt{red}+b"
set-face global header "%opt{red}"
set-face global mono   "%opt{green}"
set-face global block  "%opt{gold}"
set-face global link   "%opt{blue}+u"
set-face global bullet "%opt{red}"
set-face global list   "%opt{white}"

# tree-sitter (kak-tree-sitter): Helix's scopes, as faces named ts_<scope>
# with _ for . (keyword.control -> ts_keyword_control). A scope left unset
# takes its parent's face (kak-tree-sitter links each to the one above),
# like Helix's fallback to the nearest themed prefix.
set-face global ts_tag                      "%opt{red}"
set-face global ts_attribute                "%opt{yellow}"
set-face global ts_comment                  "%opt{lgray}+i"
set-face global ts_constant                 "%opt{cyan}"
set-face global ts_constant_numeric         "%opt{gold}"
set-face global ts_constant_builtin         "%opt{gold}"
set-face global ts_constant_character_escape "%opt{gold}"
set-face global ts_constructor              "%opt{blue}"
set-face global ts_function                 "%opt{blue}"
set-face global ts_function_builtin         "%opt{blue}"
set-face global ts_function_macro           "%opt{purple}"
set-face global ts_keyword                  "%opt{red}"
set-face global ts_keyword_control          "%opt{purple}"
set-face global ts_keyword_control_import   "%opt{red}"
set-face global ts_keyword_directive        "%opt{purple}"
set-face global ts_keyword_storage          "%opt{purple}"
set-face global ts_keyword_operator         "%opt{purple}"
set-face global ts_label                    "%opt{purple}"
set-face global ts_namespace                "%opt{blue}"
set-face global ts_operator                 "%opt{purple}"
set-face global ts_special                  "%opt{blue}"
set-face global ts_string                   "%opt{green}"
set-face global ts_type                     "%opt{yellow}"
set-face global ts_variable                 "%opt{white}"
set-face global ts_variable_builtin         "%opt{blue}"
set-face global ts_variable_parameter       "%opt{red}"
set-face global ts_variable_other_member    "%opt{red}"
set-face global ts_punctuation              "%opt{white}"
set-face global ts_punctuation_special      "%opt{purple}"
set-face global ts_markup_heading           "%opt{red}"
set-face global ts_markup_raw_inline        "%opt{green}"
set-face global ts_markup_bold              "%opt{gold}+b"
set-face global ts_markup_italic            "%opt{purple}+i"
set-face global ts_markup_strikethrough     "+s"
set-face global ts_markup_list              "%opt{red}"
set-face global ts_markup_quote             "%opt{yellow}"
set-face global ts_markup_link_url          "%opt{cyan}+u"
set-face global ts_markup_link_text         "%opt{purple}"
set-face global ts_diff_plus                "%opt{green}"
set-face global ts_diff_delta               "%opt{gold}"
set-face global ts_diff_minus               "%opt{red}"
set-face global ts_info                     "%opt{blue}+b"
set-face global ts_hint                     "%opt{green}+b"
set-face global ts_warning                  "%opt{yellow}+b"
set-face global ts_error                    "%opt{red}+b"

# interface
set-face global Default            "%opt{white},%opt{black}"
set-face global PrimarySelection   "default,%opt{gray}"
set-face global SecondarySelection "default,%opt{lblack}"
set-face global PrimaryCursor      "%opt{black},%opt{white}+fg"
set-face global SecondaryCursor    "%opt{black},%opt{lgray}+fg"
set-face global PrimaryCursorEol   "%opt{black},%opt{blue}+fg"
set-face global SecondaryCursorEol "%opt{black},%opt{lgray}+fg"
set-face global LineNumbers        "%opt{linenr},%opt{black}"
set-face global LineNumberCursor   "%opt{white},%opt{black}"
set-face global LineNumbersWrapped "%opt{lblack},%opt{black}"
set-face global MenuForeground     "%opt{black},%opt{blue}"
set-face global MenuBackground     "%opt{white},%opt{gray}"
set-face global MenuInfo           "%opt{lgray}"
set-face global Information        "%opt{white},%opt{lblack}"
set-face global InlineInformation  "%opt{lgray}"
set-face global Error              "%opt{red},%opt{black}+b"
set-face global DiagnosticError    "%opt{red}+u"
set-face global DiagnosticWarning  "%opt{yellow}+u"
set-face global DiagnosticInfo     "%opt{blue}+u"
set-face global DiagnosticHint     "%opt{green}+u"
set-face global DiagnosticTagUnnecessary +d
set-face global DiagnosticTagDeprecated  +s
# kakoune-lsp: end-of-line diagnostics, gutter flags, inlay hints, references
set-face global InlayDiagnosticError   "%opt{red}+b"
set-face global InlayDiagnosticWarning "%opt{yellow}+b"
set-face global InlayDiagnosticInfo    "%opt{blue}+b"
set-face global InlayDiagnosticHint    "%opt{green}+b"
set-face global LineFlagError      "%opt{red},%opt{black}"
set-face global LineFlagWarning    "%opt{yellow},%opt{black}"
set-face global LineFlagInfo       "%opt{blue},%opt{black}"
set-face global LineFlagHint       "%opt{green},%opt{black}"
set-face global InlayHint          "%opt{lgray}"
set-face global InlayCodeLens      "%opt{lgray}"
set-face global Reference          "default,%opt{gray}"
# hover and completion docs (kak-lsp's markdown, as markup): like Helix's
# markdown highlighting, on the info box's colours
set-face global InfoDefault        Information
set-face global InfoHeader         "%opt{red}+b"
set-face global InfoMono           "%opt{green}"
set-face global InfoBlock          "%opt{green}"
set-face global InfoBlockQuote     "%opt{yellow}"
set-face global InfoBullet         "%opt{red}"
set-face global InfoLink           "%opt{blue}+u"
set-face global InfoLinkMono       "%opt{cyan}+u"
set-face global InfoRule           "%opt{linenr}"
set-face global InfoDiagnosticError       "%opt{red}"
set-face global InfoDiagnosticWarning     "%opt{yellow}"
set-face global InfoDiagnosticInformation "%opt{blue}"
set-face global InfoDiagnosticHint        "%opt{green}"
# the status line's diagnostic counts
set-face global StatusLineError    "%opt{red},%opt{lblack}"
set-face global StatusLineWarning  "%opt{yellow},%opt{lblack}"
# git gutter (diff.plus, diff.delta, diff.minus)
set-face global GitGutterAdd       "%opt{green},%opt{black}"
set-face global GitGutterModify    "%opt{gold},%opt{black}"
set-face global GitGutterDelete    "%opt{red},%opt{black}"
set-face global StatusLine         "%opt{white},%opt{lblack}"
set-face global StatusLineMode     "%opt{black},%opt{blue}"
set-face global StatusLineInfo     "%opt{purple}"
set-face global StatusLineValue    "%opt{green}"
set-face global StatusLineInactive "%opt{lgray},%opt{lblack}"
set-face global BufferLineActive   "%opt{lblack},%opt{blue},%opt{lblack}+u"
set-face global BufferLineInactive "%opt{lgray},%opt{lblack}"
set-face global StatusCursor       "%opt{black},%opt{white}"
set-face global Prompt             "%opt{blue}"
set-face global MatchingChar       "%opt{blue},%opt{gray}+b"
set-face global BufferPadding      "%opt{linenr},%opt{black}"
set-face global Whitespace         "%opt{gray}+f"
set-face global WrapMarker         Whitespace
