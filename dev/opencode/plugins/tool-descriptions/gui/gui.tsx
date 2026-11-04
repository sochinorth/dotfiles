// The GUI part (built into ../dist/gui-experimental.cjs): the desktop app loads
// it, and OpenCode Web through the web-gui plugin.
import { onCleanup } from "solid-js"
import { Plugin, Style } from "@opencode/plugin/gui"
import { CSS, start } from "./timeline"

export default Plugin.define({
	setup(ctx) {
		ctx.add(Style, CSS)
		const stop = start(() => {
			const session = ctx.sessions.current()
			if (!session) return
			return {
				id: session.id,
				local: () => session.server.data.session.message.list(session.id),
				messages: (cursor) =>
					session.server.client.message.list({
						sessionID: session.id,
						type: "assistant",
						order: "desc",
						limit: 50,
						cursor,
					}),
			}
		})
		onCleanup(stop)
	},
})
