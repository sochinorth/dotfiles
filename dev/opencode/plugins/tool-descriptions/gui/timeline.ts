// The timeline half of tool-descriptions, run by the GUI part (gui.tsx):
// - a shell call's `description` goes on its header line, after "Shell" and
//   before the dimmed command; the chevron that opens the output stays visible;
// - file changes (edit, write, patch; consecutive ones are one block) fold
//   under a header line of their own, "Edit  <description>" ("Write", or
//   "Edits" for a mix), that opens on a click or key into the usual file rows;
// - a Thought whose summary fits on its header line shows it there, after
//   "Thought 5s", with no dropdown; a longer one stays as the app shows it,
//   unfolded with its arrow to fold. This needs the summary rendered, i.e.
//   Thinking not collapsed in Settings > Timeline > Advanced.
// A file change without a description folds under its files' names instead; a
// shell call without one is left as it was.
//
// Nothing in the app hooks into timeline rows, so this decorates the DOM of
// the 2.2.x app: a tool call's row is a tool-part-wrapper carrying its ID in
// data-timeline-part-id (several in data-timeline-part-ids), and headers are
// [data-component=tool-trigger]. If that markup changes, the decorations stop
// appearing and the timeline looks as it would without this.

export type Session = {
	id: string
	local(): any[]
	messages(cursor?: string): Promise<{ data: any[]; cursor: { next?: string | null } }>
}
type Call = { name: string; description: string }

const MARK = "data-tool-descriptions"
const FOLD = `${MARK}-fold`
const OPEN = `${MARK}-open`
const ONELINE = `${MARK}-oneline`
const MAIN = "[data-slot=basic-tool-tool-info-main]"
const TITLE = "[data-slot=basic-tool-tool-title]"
const TRIGGER = "[data-slot=collapsible-trigger]"
const TEXT = `[${MARK}=text]`
const LABEL: Record<string, string> = { edit: "Edit", write: "Write", patch: "Edit" }
const rowKey = (row: HTMLElement) => row.dataset.timelinePartId ?? row.dataset.timelinePartIds
const FILE_ROWS = "[data-component=edit-tool], [data-component=write-tool], [data-component=apply-patch-tool]"
const shownFiles = (row: Element) => [...new Set(
	[...row.querySelectorAll("[data-slot=apply-patch-filename]")].map((e) => e.textContent?.trim()).filter(Boolean),
)].join(", ")

export const CSS = `
${TEXT}, [${MARK}=thought], ${MAIN} > ${TEXT} ~ * {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
${TEXT}, [${MARK}=thought] {
	color: var(--v2-text-text-muted);
	font-weight: var(--font-weight-regular);
}
[${OPEN}] > [${MARK}=header] ${TEXT}, ${TRIGGER}[aria-expanded=true] ${TEXT} {
	white-space: normal;
	overflow: visible;
}
${TRIGGER}[aria-expanded=true]:has(${TEXT}) {
	height: auto !important;
	min-height: 28px;
}
${TEXT}:not(:last-child) {
	margin-inline-end: 4px;
}
${MAIN}:has(> ${TEXT}) {
	flex: 1 1 auto;
}
${MAIN} > ${TEXT}:not(:last-child) {
	max-width: 80%;
}
${MAIN} > ${TEXT} ~ * {
	flex: 1 1 0;
	opacity: .55;
}
[data-component=tool-part-wrapper]:has(${TEXT}) [data-slot=collapsible-arrow] {
	opacity: 1;
}
${MAIN}:has(> [${MARK}=thought]) > :not([${MARK}]) {
	flex-shrink: 0;
}
[${ONELINE}] [data-component=collapsible] > :not(${TRIGGER}),
[${ONELINE}] [data-slot=collapsible-arrow],
[data-component=reasoning-part]:not([${ONELINE}]) [${MARK}=thought],
[${FOLD}]:not([${OPEN}]) > :not([${MARK}=header]) {
	display: none !important;
}
[${ONELINE}] [data-component=collapsible], [${ONELINE}] [data-component=collapsible] * {
	pointer-events: none !important;
	cursor: default !important;
}
[${MARK}=header] {
	min-height: 28px;
}
[${MARK}=header], [${MARK}=header] ${MAIN} {
	gap: 6px;
}
[${MARK}=header] ${TITLE} {
	font-family: var(--v2-font-family-sans);
	font-weight: 530;
	letter-spacing: -.04px;
}
[${MARK}=chevron] {
	display: inline-flex;
	flex-shrink: 0;
	color: var(--icon-weaker);
	transition: transform .15s;
	transform: rotate(-90deg);
}
[${OPEN}] > [${MARK}=header] [${MARK}=chevron] {
	transform: none;
}
`

// Use the app's trigger structure and typography; dynamic text never goes in HTML.
const HEADER =
	`<div ${MARK}=header data-component=tool-trigger data-clickable=true role=button tabindex=0>` +
	`<div data-slot=basic-tool-tool-trigger-content><div data-slot=basic-tool-tool-info><div data-slot=basic-tool-tool-info-structured>` +
	`<div data-slot=basic-tool-tool-info-main><span data-slot=basic-tool-tool-title></span><span ${MARK}=text></span></div>` +
	`</div></div></div><span ${MARK}=chevron><svg width="16" height="16" viewBox="0 0 20 20" fill="none">` +
	`<path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg></span></div>`

const mark = (kind: string) => {
	const span = document.createElement("span")
	span.setAttribute(MARK, kind)
	return span
}
// Rewriting unchanged text would schedule another observer pass.
const setText = (node: Element | null, text: string) => {
	if (node && node.textContent !== text) node.textContent = text
}
const inline = (part: Element, on: boolean) => {
	part.toggleAttribute(ONELINE, on)
	const button = part.querySelector<HTMLElement>(TRIGGER)
	if (on) {
		button?.setAttribute("tabindex", "-1")
		if (button && button === document.activeElement) button.blur()
	} else button?.removeAttribute("tabindex")
}

// Innermost Markdown blocks, with a bold heading followed by a colon.
const flatten = (markdown: Element) => {
	const BLOCK = "p, h1, h2, h3, h4, h5, h6, li, pre, blockquote"
	const blocks = [...markdown.querySelectorAll(BLOCK)].filter((b) => !b.querySelector(BLOCK))
	let out = ""
	let heading = false
	for (const block of blocks.length ? blocks : markdown.children) {
		const text = block.textContent?.replace(/\s+/g, " ").trim()
		if (!text) continue
		if (out) out += heading ? ": " : " "
		out += text
		const only = block.children.length === 1 ? block.firstElementChild : null
		heading = !!only?.matches("strong, b") && only.textContent?.trim() === text
	}
	return out
}
const files = (input: any) => {
	const paths: string[] = typeof input?.path === "string" ? [input.path]
		: typeof input?.patchText === "string"
			? [...input.patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim())
			: []
	return [...new Set(paths.map((p) => p.split("/").pop() || p))].join(", ")
}
// Streaming input is incomplete JSON. Only decode the complete leading string.
const streamed = (json: string) => {
	const m = /^\s*\{\s*"description"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(json)
	try {
		return m ? { description: JSON.parse(m[1]) } : undefined
	} catch {}
}
const resolve = (part: any) => {
	const streaming = part.state?.status === "streaming"
	const input = typeof part.state?.input === "string" ? streamed(part.state.input) : part.state?.input
	const description = input?.description
	if (typeof description === "string" && description && (part.name === "shell" || part.name in LABEL))
		return { call: { name: part.name, description }, final: !streaming }
	if (!streaming) {
		const names = part.name in LABEL ? files(input) : ""
		return { call: names ? { name: part.name, description: names } : null, final: true }
	}
}

export function start(current: () => Session | undefined) {
	// null: known non-decorated call; false: absent from this session's lookup.
	const calls = new Map<string, Call | null | false>()
	const wanted = new Set<string>()
	const opened = new Set<string>()
	let shown: string | undefined
	let stopped = false
	const follow = () => {
		const id = current()?.id
		if (id === shown) return
		shown = id
		wanted.clear()
		calls.clear()
	}
	// Cache completed calls, not streamed input. Local messages supersede negative
	// results: a previous server lookup may have beaten their arrival in the app.
	let local: Map<string, any> | undefined
	const lookup = (ids: string[]) => ids.flatMap((id) => {
		let call = calls.get(id)
		if (call === undefined || call === false) {
			if (!local) {
				local = new Map()
				for (const message of current()?.local() ?? [])
					for (const part of message.content ?? []) if (part.type === "tool") local.set(part.id, part)
			}
			const part = local.get(id)
			const known = part ? resolve(part) : undefined
			if (known?.final) calls.set(id, known.call)
			if (known) call = known.call
			else if (!part && !calls.has(id)) wanted.add(id)
		}
		return call ? [call] : []
	})
	const show = (row: HTMLElement, header: Element) => {
		const open = opened.has(rowKey(row)!)
		row.toggleAttribute(OPEN, open)
		header.setAttribute("aria-expanded", String(open))
	}
	const decorateFiles = (row: HTMLElement, found: Call[]) => {
		let header = row.querySelector<HTMLElement>(`:scope > [${MARK}=header]`)
		if (!header) {
			row.insertAdjacentHTML("afterbegin", HEADER)
			const h = (header = row.firstElementChild as HTMLElement)
			const toggle = () => {
				const key = rowKey(row)!
				if (!opened.delete(key)) opened.add(key)
				show(row, h)
			}
			header.onclick = toggle
			header.onkeydown = (e) => {
				if (e.key !== "Enter" && e.key !== " ") return
				e.preventDefault()
				toggle()
			}
		}
		row.toggleAttribute(FOLD, true)
		show(row, header)
		setText(header.querySelector(TITLE), found.every((c) => c.name === found[0].name) ? LABEL[found[0].name] : "Edits")
		setText(header.querySelector(TEXT), found.map((c) => c.description).join("; "))
	}
	const decorateTools = () => {
		for (const row of document.querySelectorAll<HTMLElement>("[data-component=tool-part-wrapper]")) {
			const key = rowKey(row)
			if (!key) continue
			const ids = key.split(",")
			const found = lookup(ids)
			// Fold immediately under rendered file names, before an unsynced lookup.
			if (!found.length && !ids.every((id) => calls.has(id)) && row.querySelector(FILE_ROWS))
				found.push({
					name: row.querySelector("[data-component=write-tool]") ? "write" : "edit",
					description: shownFiles(row),
				})
			if (found[0]?.name !== "shell") {
				if (found.length) decorateFiles(row, found)
				continue
			}
			const title = row.querySelector(`[data-component=tool-trigger] ${MAIN} > ${TITLE}`)
			if (!title) continue
			let span = title.parentElement!.querySelector(`:scope > ${TEXT}`)
			if (!span) title.after((span = mark("text")))
			setText(span, found[0].description)
		}
	}

	const measured = new Map<Element, string>()
	const resized = new ResizeObserver((entries) => {
		for (const e of entries) if (measured.has(e.target)) measured.set(e.target, "")
		schedule()
	})
	const decorateThoughts = () => {
		for (const [trigger] of measured)
			if (!trigger.isConnected) {
				resized.unobserve(trigger)
				measured.delete(trigger)
			}
		for (const part of document.querySelectorAll("[data-component=reasoning-part]")) {
			const trigger = part.querySelector("[data-component=tool-trigger]")
			const main = trigger?.querySelector(MAIN)
			const markdown = part.querySelector("[data-slot=collapsible-content] [data-component=markdown]")
			const text = markdown ? flatten(markdown) : ""
			let span = main?.querySelector(`:scope > [${MARK}=thought]`)
			if (!trigger || !main || !text) {
				span?.remove()
				inline(part, false)
				if (trigger && measured.has(trigger)) measured.set(trigger, "")
				continue
			}
			span ??= main.appendChild(mark("thought"))
			setText(span, text)
			const line = trigger.textContent ?? "" // duration takes room too
			if (measured.get(trigger) === line) continue
			if (!measured.has(trigger)) resized.observe(trigger)
			measured.set(trigger, line)
			// Trial layout is never painted; remeasure only on text or size changes.
			part.toggleAttribute(ONELINE, true)
			inline(part, span.scrollWidth <= span.clientWidth + 1)
		}
	}

	let fetching = false
	let last = 0
	let retry: ReturnType<typeof setTimeout> | undefined
	const fetchWanted = async () => {
		const session = current()
		if (!session || fetching || !wanted.size) return
		const wait = last + 1000 - Date.now()
		if (wait > 0) {
			retry ??= setTimeout(() => {
				retry = undefined
				void fetchWanted()
			}, wait)
			return
		}
		fetching = true
		last = Date.now()
		const asked = new Set(wanted)
		const pending = new Set<string>()
		try {
			let cursor: string | undefined
			// Bound old/foreign row lookups. Local messages can supersede a miss.
			for (let page = 0; page < 20 && asked.size > pending.size; page++) {
				const res = await session.messages(cursor)
				if (stopped) return
				for (const message of res.data) for (const part of message.content ?? []) {
					if (part.type !== "tool" || !asked.has(part.id)) continue
					const known = resolve(part)
					// Unsynced streaming calls wait for completion, at most once a second.
					if (!known?.final) pending.add(part.id)
					else {
						calls.set(part.id, known.call)
						asked.delete(part.id)
					}
				}
				cursor = res.cursor.next ?? undefined
				if (!cursor) break
			}
			follow()
			if (session.id === shown)
				for (const id of asked) if (!pending.has(id)) calls.set(id, false)
			for (const id of wanted) if (calls.has(id)) wanted.delete(id)
		} catch (e) {
			console.error("tool-descriptions:", e)
			return
		} finally {
			fetching = false
		}
		local = undefined
		decorateTools()
		if (wanted.size) void fetchWanted()
	}

	let frame: number | undefined
	function schedule() {
		frame ??= requestAnimationFrame(() => {
			frame = undefined
			local = undefined
			follow()
			decorateThoughts()
			decorateTools()
			void fetchWanted()
		})
	}
	const observer = new MutationObserver(schedule)
	observer.observe(document.body, { childList: true, subtree: true, characterData: true })
	schedule()
	return () => {
		stopped = true
		observer.disconnect()
		resized.disconnect()
		if (frame !== undefined) cancelAnimationFrame(frame)
		clearTimeout(retry)
		document.querySelectorAll(`[${ONELINE}]`).forEach((e) => inline(e, false))
		document.querySelectorAll(`[${MARK}]`).forEach((e) => e.remove())
		for (const a of [FOLD, OPEN, ONELINE]) document.querySelectorAll(`[${a}]`).forEach((e) => e.removeAttribute(a))
	}
}
