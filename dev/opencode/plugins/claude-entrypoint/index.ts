// Claude Agent inherits the server environment; its SDK uses sdk-ts only when
// CLAUDE_CODE_ENTRYPOINT is unset. There is no per-provider env option in v2.2.4.
// This also tags other children of the OpenCode server, not standalone Claude.
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
	id: "sochinorth.claude-entrypoint",
	setup() {
		process.env.CLAUDE_CODE_ENTRYPOINT = "opencode"
		// Don't restore on unload: plugin instances in other locations share env.
	},
})
