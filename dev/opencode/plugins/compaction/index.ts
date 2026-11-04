// Compaction as a three-level tree; these are its lower two levels, kept
// for the checkpoint above them:
//   2. the session's log, every message, large tool outputs as pointers;
//   3. those outputs, whole (2 and 3: transcript.ts, in the session scratchpad,
//      which plugins/scratchpad deletes with the session).
// History in requests is never rewritten: on the providers used here that
// costs more than it saves (Claude's later thinking is invalidated, Claude
// Agent forks its session, ChatGPT's backend caches only whole earlier
// requests).
//
// Options, in opencode.json:
//   "plugins": [{ "package": "./plugins/compaction", "options": { ... } }]
//   spill   tool outputs over this many bytes are written whole. Default 4096.
//
// Edits need `opencode service restart`.
import { Plugin } from "@opencode/plugin"
import { transcript } from "./transcript"

export default Plugin.define({
	id: "sochinorth.compaction",
	async setup(ctx) {
		const t = transcript(ctx)
		await ctx.session.hook("context", (event) => t.sync(event.sessionID))
		// a turn's last reply, logged without waiting for the next request
		await ctx.session.hook("experimental.idle", (event) => t.sync(event.sessionID))
	},
})
