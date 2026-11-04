// Every shell, edit, write and patch call carries a short `description` of what
// it does, like Claude Code's Bash tool: the model writes it, and the timeline
// (gui/) shows it on the call's folded row.
//
// Only the schema the model sees gains the field. The tools' own input schemas
// ignore it, and the stored call keeps it, so it costs nothing at execution.
// Models get either patch (GPT) or edit and write (Claude); any absent tool is
// skipped. Compaction and generate requests (warming among them) send the
// session's tools too, so they get the same schemas: a request whose tools
// differ from the turns' misses their cached prompt prefix.
//
// The timeline half is the GUI part, gui/, built into dist/: the desktop app
// loads it, and so does OpenCode Web opened through the web-gui plugin.
import { Plugin } from "@opencode/plugin"

const TOOLS = ["shell", "edit", "write", "patch"]
const FIELD = {
	type: "string",
	description:
		"What this call does, in 5-10 words of active voice, e.g. 'Run the unit tests' or 'Handle empty input in parse()'. Shown to the user in place of the raw input.",
}

export default Plugin.define({
	id: "sochinorth.tool-descriptions",
	async setup(ctx) {
		for (const hook of ["context", "compaction", "generate"] as const)
			await ctx.session.hook(hook, ({ tools }) => {
				for (const name of TOOLS) {
					const tool = tools[name]
					if (!tool) continue
					const { properties, required = [] } = tool.input as { properties?: object; required?: string[] }
					tools[name] = {
						...tool,
						input: {
							...tool.input,
							// first, so it's written (and streamed) before a long command or patch
							properties: { description: FIELD, ...properties },
							required: [...new Set(["description", ...required])],
						},
					}
				}
			})
	},
})
