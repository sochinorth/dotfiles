// Claude Agent inherits the server environment (v2.2.4 has no per-provider env
// option), so this sets in the server:
// - CLAUDE_CODE_ENTRYPOINT=opencode: the SDK uses sdk-ts only when it's unset.
// - CLAUDE_CODE_DISABLE_ARTIFACT=1: Claude Code's own scratchpad rides on its
//   Artifact tool, which Claude Agent never gives Claude anyway, and would
//   compete with plugins/scratchpad's.
// OpenCode's shell commands don't get them, so `claude` run from one stays
// standalone. Other children of the server (terminals, MCP servers) inherit
// them, and they stay set until the server exits: README.md has the caveats.
import { Plugin } from "@opencode/plugin"

const ENV = { CLAUDE_CODE_ENTRYPOINT: "opencode", CLAUDE_CODE_DISABLE_ARTIFACT: "1" }

export default Plugin.define({
	id: "sochinorth.claude-entrypoint",
	async setup(ctx) {
		Object.assign(process.env, ENV)
		await ctx.shell.hook("create.before", ({ env }) => {
			for (const [name, value] of Object.entries(ENV)) if (env[name] === value) delete env[name]
		})
	},
})
