// The timeline half of tool-descriptions, run by the GUI part (gui.tsx):
// - a shell call's `description` goes on its header line, after "Shell" and
//   before the dimmed command; the chevron that opens the output stays visible;
// - file changes (edit, write, patch; consecutive ones are one block) fold
//   under a header line of their own, "Edit  <description>", that opens on a
//   click into the usual file rows;
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

export type Page = { data: unknown[]; cursor: { next?: string | null } }
export type Session = {
	id: string
	// the app's synced messages of the session, as the timeline renders them
	local?(): unknown[]
	// the session's assistant messages from the server, newest first: for
	// calls not synced (yet)
	messages(cursor?: string): Promise<Page>
}

const MARK = "data-tool-descriptions" // on every element we insert
const FOLD = "data-tool-descriptions-fold" // on a file-change block we fold
const OPEN = "data-tool-descriptions-open" // ... while unfolded
const ONELINE = "data-tool-descriptions-oneline" // on a Thought shown inline

// a patch reads as an edit: its row can't be told from one before it's looked up
const LABEL: Record<string, string> = { edit: "Edit", write: "Write", patch: "Edit" }

// the app's file-change rows, and the file names their headers show
const FILE_ROWS = "[data-component=edit-tool], [data-component=write-tool], [data-component=apply-patch-tool]"
const shownFiles = (row: Element) => [
	...new Set(
		[...row.querySelectorAll("[data-slot=apply-patch-filename]")].map((e) => e.textContent?.trim() ?? "").filter(Boolean),
	),
]

export const CSS = `
/* the tool's name stays the row's title; the description reads like a Thought's summary */
[${MARK}=text] {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 13px;
	color: var(--v2-text-text-muted);
	font-weight: var(--font-weight-regular);
}
/* opened, a row shows its description in full, wrapped */
[${OPEN}] > [${MARK}=header] [${MARK}=text],
[data-slot=collapsible-trigger][aria-expanded=true] [${MARK}=text] {
	white-space: normal;
	overflow: visible;
}
[data-slot=collapsible-trigger][aria-expanded=true]:has([${MARK}=text]) {
	height: auto !important;
	min-height: 28px;
}
/* on top of the row's 8px gap: apart from the command after it */
[${MARK}=text]:not(:last-child) {
	margin-inline-end: 4px;
}
[data-slot=basic-tool-tool-info-main]:has(> [${MARK}=text]) {
	flex: 1 1 auto;
}
/* the description keeps its width; the command after it gets what's left */
[data-slot=basic-tool-tool-info-main] > [${MARK}=text]:not(:last-child) {
	flex: 0 1 auto;
	max-width: 80%;
}
[data-slot=basic-tool-tool-info-main] > [${MARK}=text] ~ * {
	flex: 1 1 0;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: .55;
}
[data-component=tool-part-wrapper]:has([${MARK}=text]) [data-slot=collapsible-arrow] {
	opacity: 1;
}
[${MARK}=thought] {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--v2-text-text-muted);
	font-weight: var(--font-weight-regular);
}
/* "Thought" and its duration keep their width; the summary gets what's left */
[data-slot=basic-tool-tool-info-main]:has(> [${MARK}=thought]) > :not([${MARK}]) {
	flex-shrink: 0;
}
/* An inline Thought is its header line alone, whether the app has it open or
   closed (Thinking collapsed or not): nothing but the trigger shows, and
   nothing in it takes a click, so it can't open onto blank space. */
[${ONELINE}] [data-component=collapsible] > :not([data-slot=collapsible-trigger]),
[${ONELINE}] [data-slot=collapsible-content],
[${ONELINE}] [data-slot=collapsible-arrow],
[data-component=reasoning-part]:not([${ONELINE}]) [${MARK}=thought] {
	display: none !important;
}
[${ONELINE}] [data-component=collapsible],
[${ONELINE}] [data-component=collapsible] * {
	pointer-events: none !important;
	cursor: default !important;
}
[${FOLD}]:not([${OPEN}]) > :not([${MARK}=header]) {
	display: none !important;
}
[${MARK}=header] {
	cursor: pointer;
	min-height: 28px;
}
/* spaced and lettered like the app's compact rows (Shell, Thought) */
[${MARK}=header],
[${MARK}=header] [data-slot=basic-tool-tool-info-main] {
	gap: 6px;
}
[${MARK}=header] [data-slot=basic-tool-tool-title] {
	font-family: var(--v2-font-family-sans);
	font-size: 13px;
	font-weight: 530;
	line-height: var(--line-height-compact);
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

type Call = { name: string; description: string }

const el = (tag: string, attrs: Record<string, string>, ...children: (Node | string)[]) => {
	const e = document.createElement(tag)
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
	e.append(...children)
	return e
}

const chevronEl = () => {
	const chevron = el("span", { [MARK]: "chevron" })
	chevron.innerHTML =
		'<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>'
	return chevron
}

// A Thought's summary as one line: its blocks joined, a bold heading block
// (OpenAI's "**Checking parity**") followed by a colon.
const flatten = (markdown: Element) => {
	let out = ""
	let heading = false
	// the app wraps paragraphs in its own block divs; take the innermost blocks
	const BLOCK = "p, h1, h2, h3, h4, h5, h6, li, pre, blockquote"
	const blocks = [...markdown.querySelectorAll(BLOCK)].filter((b) => !b.querySelector(BLOCK))
	for (const block of blocks.length ? blocks : markdown.children) {
		const text = block.textContent?.replace(/\s+/g, " ").trim()
		if (!text) continue
		if (out) out += heading ? ": " : " "
		out += text
		const strong = block.children.length === 1 && block.firstElementChild?.matches("strong, b")
		heading = !!strong && block.firstElementChild!.textContent?.trim() === text
	}
	return out
}

// a header line in the app's own tool-trigger markup, so it's styled like the rest
const fileHeader = (onClick: () => void) => {
	const chevron = chevronEl()
	const header = el(
		"div",
		{ [MARK]: "header", "data-component": "tool-trigger", "data-clickable": "true", role: "button", tabindex: "0" },
		el(
			"div",
			{ "data-slot": "basic-tool-tool-trigger-content" },
			el(
				"div",
				{ "data-slot": "basic-tool-tool-info" },
				el(
					"div",
					{ "data-slot": "basic-tool-tool-info-structured" },
					el(
						"div",
						{ "data-slot": "basic-tool-tool-info-main" },
						el("span", { "data-slot": "basic-tool-tool-title" }),
						el("span", { [MARK]: "text" }),
					),
				),
			),
		),
		chevron,
	)
	header.addEventListener("click", onClick)
	header.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" && e.key !== " ") return
		e.preventDefault()
		onClick()
	})
	return header
}

// the names of the files a file change touches: edit and write name one, a
// patch names each in its "*** Update File: <path>" lines
const files = (input: any): string[] => {
	const paths: string[] =
		typeof input?.path === "string"
			? [input.path]
			: typeof input?.patchText === "string"
				? [...input.patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m: RegExpMatchArray) => m[1].trim())
				: []
	return [...new Set(paths.map((p) => p.split("/").pop() || p))]
}

const setText = (node: Element | null | undefined, text: string) => {
	if (node && node.textContent !== text) node.textContent = text
}

// Starts decorating the document; returns a function that stops and undoes it.
export function start(current: () => Session | undefined): () => void {
	// tool call ID -> what it was; null once known to be no call we decorate
	const calls = new Map<string, Call | null>()
	const wanted = new Set<string>()
	const opened = new Set<string>() // file-change blocks unfolded, by their IDs

	// What a stored tool part makes of a row: its call (null: nothing to
	// decorate), and whether that's final; undefined while its input is still
	// coming without a description yet. A description streams in first, so a
	// running call usually has it before its command.
	const resolve = (part: any): { call: Call | null; final: boolean } | undefined => {
		const streaming = part.state?.status === "streaming"
		const description = part.state?.input?.description
		if (typeof description === "string" && description && (part.name === "shell" || part.name in LABEL))
			return { call: { name: part.name, description }, final: !streaming }
		if (streaming) return
		// a file change without one still folds, under its files' names
		if (part.name in LABEL && files(part.state?.input).length)
			return { call: { name: part.name, description: files(part.state.input).join(", ") }, final: true }
		return { call: null, final: true }
	}

	// the app's own synced messages, indexed once per pass: the rows on screen
	// render from them, so a row's call is there the moment it renders
	let local: Map<string, unknown> | undefined
	const localPart = (id: string) => {
		if (!local) {
			local = new Map()
			for (const message of (current()?.local?.() ?? []) as any[])
				for (const part of message.content ?? []) if (part.type === "tool") local.set(part.id, part)
		}
		return local.get(id)
	}

	const lookup = (ids: string[]) => {
		const found: Call[] = []
		for (const id of ids) {
			let call = calls.get(id)
			if (call === undefined) {
				const part = localPart(id)
				const known = part ? resolve(part) : undefined
				if (known?.final) calls.set(id, known.call)
				if (known) call = known.call
				else if (!part) wanted.add(id) // not synced (yet): ask the server
			}
			if (call) found.push(call)
		}
		return found
	}

	const decorateShell = (row: HTMLElement, call: Call) => {
		const main = row.querySelector("[data-component=tool-trigger] [data-slot=basic-tool-tool-info-main]")
		if (!main) return
		let span = main.querySelector(`:scope > [${MARK}=text]`)
		if (!span) {
			span = el("span", { [MARK]: "text" })
			const title = main.querySelector(":scope > [data-slot=basic-tool-tool-title]")
			if (title) title.after(span)
			else main.prepend(span)
		}
		setText(span, call.description)
	}

	const decorateFiles = (row: HTMLElement, key: string, found: Call[]) => {
		let header = row.querySelector<HTMLElement>(`:scope > [${MARK}=header]`)
		if (!header) {
			header = fileHeader(() => {
				if (opened.has(key)) opened.delete(key)
				else opened.add(key)
				row.toggleAttribute(OPEN, opened.has(key))
			})
			row.prepend(header)
		}
		if (!row.hasAttribute(FOLD)) row.setAttribute(FOLD, "")
		if (row.hasAttribute(OPEN) !== opened.has(key)) row.toggleAttribute(OPEN, opened.has(key))
		const names = new Set(found.map((c) => c.name))
		setText(header.querySelector("[data-slot=basic-tool-tool-title]"), names.size === 1 ? LABEL[found[0].name] : "Edits")
		setText(header.querySelector(`[${MARK}=text]`), found.map((c) => c.description).join("; "))
	}

	const decorateTools = () => {
		for (const row of document.querySelectorAll<HTMLElement>("[data-component=tool-part-wrapper]")) {
			const key = row.dataset.timelinePartId ?? row.dataset.timelinePartIds ?? ""
			if (!key) continue
			const ids = key.split(",")
			const found = lookup(ids)
			// A file change folds the moment it renders, under the file names its
			// rows show, until its calls are looked up: no flash of open diffs.
			if (found.length === 0 && !ids.every((id) => calls.has(id)) && row.querySelector(FILE_ROWS)) {
				const name = row.querySelector("[data-component=write-tool]") ? "write" : "edit"
				decorateFiles(row, key, [{ name, description: shownFiles(row).join(", ") }])
				continue
			}
			if (found.length === 0) continue
			if (found[0].name === "shell") decorateShell(row, found[0])
			else decorateFiles(row, key, found)
		}
	}

	// whether a summary fits its header line changes with the window too
	const resized = new ResizeObserver(() => schedule())

	// A Thought whose summary fits on its header line shows it there, with no
	// dropdown; one that doesn't is left to the app (shown in full, with the
	// app's arrow to fold it). Fitting is measured with the summary in place,
	// within one task, so the trial layout is never painted.
	const decorateThoughts = () => {
		for (const part of document.querySelectorAll<HTMLElement>("[data-component=reasoning-part]")) {
			const trigger = part.querySelector<HTMLElement>("[data-component=tool-trigger]")
			const main = trigger?.querySelector("[data-slot=basic-tool-tool-info-main]")
			const markdown = part.querySelector("[data-slot=collapsible-content] [data-component=markdown]")
			const text = markdown ? flatten(markdown) : ""
			let span = main?.querySelector<HTMLElement>(`:scope > [${MARK}=thought]`)
			if (!trigger || !main || !text) {
				span?.remove()
				if (part.hasAttribute(ONELINE)) part.removeAttribute(ONELINE)
				continue
			}
			if (!span) {
				span = main.appendChild(el("span", { [MARK]: "thought" }))
				resized.observe(trigger)
			}
			setText(span, text)
			if (!part.hasAttribute(ONELINE)) part.setAttribute(ONELINE, "")
			if (span.scrollWidth > span.clientWidth + 1) part.removeAttribute(ONELINE)
		}
	}

	// Look the wanted calls up in the session's messages. One still being
	// written is asked about again, at most once a second.
	let fetching = false
	let last = 0
	let retry: ReturnType<typeof setTimeout> | undefined
	const fetchWanted = async () => {
		const session = current()
		if (!session || fetching || wanted.size === 0) return
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
			for (let page = 0; page < 20 && asked.size > pending.size; page++) {
				const res = await session.messages(cursor)
				for (const message of res.data as any[]) {
					for (const part of message.content ?? []) {
						if (part.type !== "tool" || !asked.has(part.id)) continue
						const known = resolve(part)
						if (!known?.final) {
							pending.add(part.id)
							continue
						}
						calls.set(part.id, known.call)
						asked.delete(part.id)
					}
				}
				cursor = res.cursor.next ?? undefined
				if (!cursor) break
			}
			// not among this session's calls at all: not a row we decorate
			for (const id of asked) if (!pending.has(id)) calls.set(id, null)
			for (const id of wanted) if (calls.has(id)) wanted.delete(id)
		} catch (e) {
			console.error("tool-descriptions:", e)
		} finally {
			fetching = false
		}
		decorateTools()
		if (pending.size) void fetchWanted()
	}

	let queued = false
	function schedule() {
		if (queued) return
		queued = true
		requestAnimationFrame(() => {
			queued = false
			local = undefined
			decorateThoughts()
			decorateTools()
			void fetchWanted()
		})
	}
	const observer = new MutationObserver(schedule)
	observer.observe(document.body, { childList: true, subtree: true, characterData: true })

	return () => {
		observer.disconnect()
		resized.disconnect()
		clearTimeout(retry)
		document.querySelectorAll(`[${MARK}]`).forEach((e) => e.remove())
		for (const a of [FOLD, OPEN, ONELINE]) document.querySelectorAll(`[${a}]`).forEach((e) => e.removeAttribute(a))
	}
}
