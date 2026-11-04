// Every shell, edit, write and patch call carries a short `description` of what
// it does, like Claude Code's Bash tool: the model writes it, and the timeline
// (gui/) shows it on the call's folded row.
//
// Only the schema the model sees gains the field. The tools' own input schemas
// ignore it, and the stored call keeps it, so it costs nothing at execution.
// Models get either patch (GPT) or edit and write (Claude); any absent tool is
// skipped.
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

type ObjectSchema = { properties?: Record<string, unknown>; required?: string[] }

export default Plugin.define({
	id: "sochinorth.tool-descriptions",
	async setup(ctx) {
		await ctx.session.hook("context", (event) => {
			for (const name of TOOLS) {
				const tool = event.tools[name]
				if (!tool) continue
				const input = tool.input as ObjectSchema
				event.tools[name] = {
					...tool,
					input: {
						...input,
						// first, so it's written (and streamed) before a long command or patch
						properties: { description: FIELD, ...input.properties },
						required: [...new Set(["description", ...(input.required ?? [])])],
					},
				}
			}
		})
	},
})
