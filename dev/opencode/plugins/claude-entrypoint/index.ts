// Claude Agent inherits the server environment; there is no per-provider env
// option in v2.2.4. So this sets, in the server:
// - CLAUDE_CODE_ENTRYPOINT=opencode: the SDK uses sdk-ts only when it's unset.
// - CLAUDE_CODE_DISABLE_ARTIFACT=1: Claude Code's scratchpad
//   (/tmp/claude-<uid>/.../scratchpad, "always use it") rides on its Artifact tool
//   being available, and would compete with plugins/scratchpad's, which every
//   model sees. Claude Agent gives Claude no built-in tools, Artifact included, so
//   only that line goes.
// OpenCode's shell commands don't get them, so `claude` run from them stays
// standalone (claude-transcripts deletes untracked "opencode" transcripts) and
// keeps its artifacts. Other children of the server (MCP servers, terminals)
// inherit them.
import { Plugin } from "@opencode/plugin"

const ENV: Record<string, string> = { CLAUDE_CODE_ENTRYPOINT: "opencode", CLAUDE_CODE_DISABLE_ARTIFACT: "1" }

export default Plugin.define({
	id: "sochinorth.claude-entrypoint",
	async setup(ctx) {
		Object.assign(process.env, ENV)
		// Don't restore on unload: plugin instances in other locations share env.
		await ctx.shell.hook("create.before", (input) => {
			for (const [name, value] of Object.entries(ENV)) if (input.env[name] === value) delete input.env[name]
		})
	},
})
