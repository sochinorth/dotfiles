// The GUI part (built into ../dist/gui-experimental.cjs): the desktop app loads
// it, and OpenCode Web through the web-gui proxy. A pill above the composer
// carries the offer; opening it shows the explanation in a dialog.
//
// It polls, which is also how the server learns which sessions are open: an event
// stream would need reconnecting and still couldn't say that.
//
// Every call goes through the session's own server. ctx.client is the desktop
// app's built-in server, which a browser tab doesn't have.
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Command, ComposerPill, createKeyed, Plugin, type SessionRef } from "@opencode/plugin/gui"
import { YouShouldKnow, type Action, type View } from "../rpc"

const POLL_MS = 5_000

const draft = (view: View) => {
	const parts = [`${view.tag} · ${view.line}`, view.title && `**${view.title}**`, view.explanation].filter(Boolean)
	const quoted = parts.join("\n\n").split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n")
	return `A side agent watching this session left me this note:\n\n${quoted}\n\n`
}

export default Plugin.define({
	setup(ctx) {
		const [views, setViews] = createStore<Record<string, View | null>>({})
		const [off, setOff] = createSignal(false)

		const report = (error: unknown) => console.error("you-should-know:", error)
		const rpcOf = (session: SessionRef) => session.server.client.rpc(YouShouldKnow)
		const opened = () => {
			const current = ctx.sessions.current()
			const list = ctx.sessions.list()
			return current && !list.some((session) => session.id === current.id) ? [current, ...list] : list
		}
		const poll = () => {
			for (const session of opened()) {
				if (!session.server.connected) continue
				void rpcOf(session)
					.view({ sessionID: session.id }, { location: session.location })
					.then((output) => {
						const answer = output as { view: View | null; off: boolean }
						setViews(session.id, answer.view)
						if (session.id === ctx.sessions.current()?.id) setOff(answer.off)
					})
					.catch(report)
			}
		}
		const act = async (session: SessionRef, action: Action) => {
			const output = await rpcOf(session).act({ sessionID: session.id, action }, { location: session.location })
			setViews(session.id, (output as { view: View | null }).view)
		}

		const timer = setInterval(poll, POLL_MS)
		createKeyed(() => opened().map((session) => session.id).join(), poll)

		const open = (session: SessionRef, composer: () => ReturnType<typeof ctx.screen.current>) => {
			const ui = ctx.ui
			const view = () => views[session.id]
			ctx.dialogs.open((dialog) => {
				const answer = (action: Action) => () => {
					dialog.close()
					void act(session, action).catch(report)
				}
				const chat = () => {
					const current = view()
					const box = composer()?.composer
					if (!current || !box || ctx.sessions.current()?.id !== session.id) return
					if (box.text().trim()) {
						ctx.toast.show({ variant: "error", title: "Can't add the note while you have a draft. Send or clear the draft first." })
						return
					}
					box.setText(draft(current))
					box.focus()
					dialog.close()
					void act(session, "understood").catch(report)
				}
				return (
					<ui.Dialog
						title={view()?.title || view()?.tag || "You should know"}
						size="normal"
						footer={
							<>
								<ui.Button variant="ghost-muted" onClick={answer("dismiss")}>Dismiss</ui.Button>
								<ui.Button variant="neutral" onClick={chat}>Chat in main session</ui.Button>
								<ui.Button variant="contrast" onClick={answer("understood")}>Understood</ui.Button>
							</>
						}
					>
						<ui.Markdown text={view()?.explanation ?? ""} />
					</ui.Dialog>
				)
			})
		}

		// The host styles a menu's heading faint and its rows bright, which would put the notice below
		// its own buttons, so this is `menu` rather than `rows`: the tag is the heading and the notice the body.
		ctx.add(ComposerPill, {
			id: "offer",
			show: (input) => {
				const view = views[input.session.id]
				return view ? { label: `✦ ${view.tag} · ${view.line}`, title: view.tag } : undefined
			},
			menu: (input) => {
				const ui = ctx.ui
				const view = () => views[input.session.id]
				const then = (run: (session: SessionRef) => void) => () => {
					const { session } = input
					input.close()
					run(session)
				}
				const answer = (action: Action) => then((session) => void act(session, action).catch(report))
				const read = then((session) => {
					if (view()?.kind === "offer") void act(session, "learn").then(() => open(session, () => input.screen)).catch(report)
					else open(session, () => input.screen)
				})
				return (
					<div style={{ padding: "2px 8px 6px" }}>
						<p dir="auto" style={{ margin: "0 0 10px", "font-size": "14px", "line-height": "1.45" }}>
							{view()?.line}
						</p>
						<div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px", margin: "0 -6px" }}>
							<ui.Button size="small" variant="neutral" onClick={read}>
								{view()?.kind === "offer" ? "Learn more" : "Read it again"}
							</ui.Button>
							<ui.Button size="small" variant="ghost-muted" onClick={answer("knew")}>
								{view()?.kind === "offer" ? "Knew this already" : "Understood"}
							</ui.Button>
							<ui.Button size="small" variant="ghost-muted" onClick={answer("dismiss")}>Dismiss</ui.Button>
						</div>
					</div>
				)
			},
		})
		ctx.add(Command, () => ({
			id: "toggle",
			title: off() ? "You should know: turn suggestions on" : "You should know: turn suggestions off",
			enabled: !!ctx.sessions.current(),
			run: () => {
				const next = !off()
				setOff(next)
				const session = ctx.sessions.current()
				if (session) void rpcOf(session).setOff({ off: next }, { location: session.location }).catch(report)
			},
		}))

		return () => clearInterval(timer)
	},
})
