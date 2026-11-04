// follow-tools' GUI part (built into ../dist/gui-experimental.cjs): the desktop
// app loads it, and OpenCode Web through the web-gui proxy. It keeps the
// grouped tool block the agent is working in ("Used 13 Shell, Grep, Read")
// unfolded while the agent works in it, so its calls show as they run, and
// folds it again once the agent moves on: a note (text), another block, or the
// end of the turn.
//
// It opens each block once. A block the user folds or unfolds is theirs from
// then on: it isn't reopened, or folded when the agent moves on. Blocks the
// user opened themselves are left alone.
//
// Nothing in the app hooks into timeline groups, so this reads the DOM of the
// 2.2.x app and clicks the group's own trigger, which keeps the app's open
// state, scroll handling and keyboard behavior. A timeline row is a
// [data-timeline-key] wrapper holding [data-index] and a [data-timeline-row]
// element (its kind, and data-message-id: the turn's user message). The app's
// own "busy" group is the last AssistantPart row of the running turn, when
// that row is a [data-component=collapsed-tool-group]. The timeline is
// virtualized, but always renders the running turn's last row. If the rows
// between it and that AssistantPart aren't all rendered, the last rendered
// AssistantPart of the turn may still be the busy one: it's kept as it is,
// and every other group is folded. If the markup changes, nothing unfolds and
// the timeline works as without this.
import { createKeyed, Plugin } from "@opencode/plugin/gui"

const GROUP = "[data-component=collapsed-tool-group]"
const TRIGGER = `${GROUP} > [data-component=collapsible] > [data-slot=collapsible-trigger]`

type Row = { index: number; kind?: string; turn?: string; key: string; trigger: HTMLElement | null }
// The group to leave as it is (none: fold every group this plugin opened), and
// whether it's surely the busy one, to open.
type Verdict = { keep?: Row; sure: boolean }

const expanded = (t: HTMLElement) => t.getAttribute("aria-expanded") === "true"

export default Plugin.define({
	setup(ctx) {
		// Each group handled: "open" (unfolded by this plugin, to fold when the
		// agent moves on) or "done" (never to touch again).
		const groups = new Map<string, "open" | "done">()

		const rows = (container: Element) =>
			[...container.querySelectorAll<HTMLElement>(":scope > [data-timeline-key]")]
				.map((wrapper): Row => {
					const el = wrapper.querySelector<HTMLElement>("[data-timeline-row]")
					return {
						index: Number(wrapper.querySelector<HTMLElement>(":scope > [data-index]")?.dataset.index),
						kind: el?.dataset.timelineRow,
						turn: el?.dataset.messageId,
						key: wrapper.dataset.timelineKey!,
						trigger: wrapper.querySelector<HTMLElement>(TRIGGER),
					}
				})
				.filter((r) => Number.isInteger(r.index))
				.sort((a, b) => a.index - b.index)

		// Undefined for a timeline that isn't the current session's, or not loaded yet.
		const verdict = (list: Row[]): Verdict | undefined => {
			const session = ctx.sessions.current()
			if (!session) return
			const data = session.server.data.session
			// Queued prompts render after the running turn.
			const pending = new Set(data.pending.list(session.id).map((p) => p.id))
			const last = list.findLast((r) => r.turn && !pending.has(r.turn) && r.kind !== "CompactionQueued")
			if (!last?.turn || !data.message.get(session.id, last.turn)) return
			if (data.status(session.id) !== "running") return { sure: true }
			const at = list.indexOf(last)
			for (let i = at; i >= 0 && list[i].turn === last.turn; i--)
				// Sure when every row from it to the turn's last is rendered.
				if (list[i].kind === "AssistantPart") return { keep: list[i], sure: at - i === last.index - list[i].index }
			return { sure: true }
		}

		const pass = () => {
			const containers = new Set([...document.querySelectorAll("[data-timeline-key]")].map((w) => w.parentElement!))
			for (const container of containers) {
				if (!container.checkVisibility({ visibilityProperty: true })) continue
				const list = rows(container)
				const v = verdict(list)
				if (!v) continue
				for (const row of list) {
					if (!row.trigger || row === v.keep || groups.get(row.key) !== "open") continue
					groups.set(row.key, "done")
					if (expanded(row.trigger)) row.trigger.click()
				}
				const { keep } = v
				if (!v.sure || !keep?.trigger || groups.has(keep.key)) continue
				// Already open: the user's doing.
				const open = expanded(keep.trigger)
				groups.set(keep.key, open ? "done" : "open")
				if (!open) keep.trigger.click()
			}
		}

		// The user's own toggles (trusted events; this plugin's clicks aren't).
		const touched = (e: Event) => {
			if (!e.isTrusted || (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ")) return
			const key = (e.target as Element).closest?.(TRIGGER)?.closest<HTMLElement>("[data-timeline-key]")?.dataset.timelineKey
			if (key) groups.set(key, "done")
		}

		let frame: number | undefined
		const schedule = () => {
			frame ??= requestAnimationFrame(() => {
				frame = undefined
				try {
					pass()
				} catch (e) {
					console.error("follow-tools:", e)
				}
			})
		}
		// Rows coming and going, and the session or its status changing (a turn
		// can end without either).
		const observer = new MutationObserver(schedule)
		observer.observe(document.body, { childList: true, subtree: true })
		createKeyed(() => {
			const s = ctx.sessions.current()
			return s && `${s.key}\n${s.server.data.session.status(s.id)}`
		}, schedule)
		document.addEventListener("click", touched, true)
		document.addEventListener("keydown", touched, true)
		return () => {
			observer.disconnect()
			document.removeEventListener("click", touched, true)
			document.removeEventListener("keydown", touched, true)
			if (frame !== undefined) cancelAnimationFrame(frame)
		}
	},
})
