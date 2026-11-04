// Claude Agent inherits the server environment; its SDK uses sdk-ts only when
// CLAUDE_CODE_ENTRYPOINT is unset. There is no per-provider env option in v2.2.4.
// OpenCode's shell commands don't get the tag, so `claude` run from them stays
// standalone (claude-transcripts deletes untracked "opencode" transcripts). Other
// children of the server (MCP servers, terminals) inherit it.
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
	id: "sochinorth.claude-entrypoint",
	async setup(ctx) {
		process.env.CLAUDE_CODE_ENTRYPOINT = "opencode"
		// Don't restore on unload: plugin instances in other locations share env.
		await ctx.shell.hook("create.before", (input) => {
			if (input.env.CLAUDE_CODE_ENTRYPOINT === "opencode") delete input.env.CLAUDE_CODE_ENTRYPOINT
		})
	},
})
