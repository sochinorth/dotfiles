// The session's transcript, in its session scratchpad:
//   transcripts/<sessionID>/log/0001.md  the conversation up to the first compaction,
//                          log/0002.md  from its checkpoint to the next one...
//   transcripts/<sessionID>/T0001.out    a large tool output, whole
//   transcripts/<sessionID>/state.json   the session's state: how far the log got
//                          (so restarts and reloads don't log twice), the large
//                          outputs of the current stretch, and the checkpoint's
// The log is appended from ctx.session.context() before each step and before a
// compaction; a large output is written to its T file then, and its entry points
// at it. The model's copy of an output is never changed. The cursor resumes at
// its message's place in the list, and a revert resumes at the last message of
// the segment's logged IDs still there. IDs don't order messages (a fork's copies
// end in an unpadded _<seq>, a queued message keeps the older ID it was queued
// with) and neither does the wall clock, which can step back. All of it is
// deleted with the session's scratchpad and moves with it; a fork gets a new
// session ID, so it starts a transcript, and a state, of its own.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import type { Plugin } from "@opencode/plugin"

const LEAF_BYTES = 4096
const INPUT_CHARS = 300
const PRIVATE = { mode: 0o600 }
const SESSION_ID = /^ses_[A-Za-z0-9]+$/
const NATIVE = "native: an encrypted checkpoint OpenAI keeps; this segment's index follows"

type Cursor = { segment: number; compaction?: string; message?: string; parts?: number; logged?: string[] }
/** A large output written whole, one of the current stretch's. */
export type Leaf = { anchor: string; tool: string; input: string; bytes: number }

export type Transcript = ReturnType<typeof transcript>
// one record per session; its modules each keep their own field
export type State = { cursor?: Cursor; leaves?: Leaf[]; [field: string]: any }

// Plugin instances per location share one process: one sync queue and one state
// per session across them.
const shared: { queues: Map<string, Promise<void>>; states: Map<string, State> } = ((globalThis as any)[
	Symbol.for("sochinorth.compaction.transcript")
] ??= {})
shared.queues ??= new Map()
shared.states ??= new Map() // by state file path, so a moved scratchpad's is read anew

/** The text of tool content as the model reads it: text parts joined by newlines. */
export const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? content.flatMap((p) => (p?.type === "text" ? [p.text] : [])).join("\n") : ""
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1 << 20 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1 << 20)).toFixed(1)} MB`)
const at = (ms: unknown) => new Date(typeof ms === "number" ? ms : Date.now()).toISOString().replace("T", " ").slice(0, 19) + "Z"
// OpenCode's read tool refuses a file with a NUL in it as binary, and a tool's
// output can carry raw bytes (strings of a binary, a cat of one): T files lose
// their NULs, the log, read as text, every control character but tab and newline.
const unnul = (text: string) => text.replaceAll("\0", "�")
const printable = (text: string) => text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "�")
const clip = (text: string, max: number) => {
	if (Buffer.byteLength(text) <= max) return text
	const head = Math.floor((max * 2) / 3)
	const tail = max - head
	return `${text.slice(0, head)}\n… ${size(Buffer.byteLength(text) - max)} omitted …\n${text.slice(-tail)}`
}

/** A tool input in a line: its main argument first, then the rest as key=value. */
export function brief(input: unknown): string {
	const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
	const main = ["command", "path", "pattern", "query", "url"].find((k) => typeof o[k] === "string")
	const rest = Object.entries(o).filter(([k, v]) => k !== main && k !== "description" && v !== undefined)
	const s = [main ? String(o[main]) : "", ...rest.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)]
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
	return s.length > INPUT_CHARS ? `${s.slice(0, INPUT_CHARS - 1)}…` : s
}

// A log entry for one message, or for each part of an assistant message from
// `from` on. `parts` is how many were logged; it stops early at a tool still
// running in the newest message. `output` is how an output is logged: inline,
// or as a pointer to the T file it's written to.
function entries(m: any, from: number, newest: boolean, output: (text: string, tool: string, input?: unknown) => string): { text: string[]; parts: number } {
	// only an assistant message grows after it's logged
	if (from > 0 && m.type !== "assistant") return { text: [], parts: 1 }
	const time = at(m.time?.created)
	const one = (text: string) => ({ text: [text], parts: 1 })
	switch (m.type) {
		case "user": {
			const files = (m.files ?? []).map((f: any) => `[attached: ${f.name ?? f.source?.uri ?? f.mime} (${f.mime})]`)
			return one([`## user · ${time}`, m.text, ...files].join("\n"))
		}
		// what the model read, a subagent's report among them; the description only labels it
		case "synthetic": {
			const label = m.description && m.description !== m.text ? clip(m.description, 1024) : ""
			const body = m.text ? output(m.text, m.type, { title: m.description }) : ""
			return one([`## synthetic · ${time}`, label, body].filter(Boolean).join("\n"))
		}
		case "system":
			return one(`## system · ${time}\n${clip(m.description || m.text || "", 1024)}`)
		case "skill":
			return one(`## skill ${m.name} · ${time}`)
		case "shell": {
			const status = m.status === "exited" ? `exit ${m.exit ?? "?"}` : m.status
			return one(`## shell · ${status} · ${time}\n$ ${m.command}\n${output(m.output?.output ?? "", "shell", { command: m.command })}`)
		}
		case "agent-switched":
			return one(`## agent ${m.agent} · ${time}`)
		case "model-switched":
			return one(`## model ${m.model?.providerID}/${m.model?.id} · ${time}`)
		case "location-switched":
			return one(`## location ${m.location?.directory} · ${time}`)
		case "assistant":
			break
		default:
			return { text: [], parts: 1 }
	}
	const content: any[] = m.content ?? []
	const text: string[] = []
	for (let i = from; i < content.length; i++) {
		const p = content[i]
		if (p.type === "text" && p.text.trim()) text.push(`## assistant · ${time}\n${p.text}`)
		if (p.type !== "tool") continue
		const state = p.state ?? {}
		const done = state.status === "completed" || state.status === "error"
		if (!done && newest) return { text, parts: i }
		const head = `## tool ${p.name} · ${done ? state.status : "unfinished"} · ${brief(state.input)} · ${at(p.time?.completed ?? m.time?.created)}`
		const body = output([state.error?.message, textOf(state.content)].filter(Boolean).join("\n"), p.name, state.input).trimEnd()
		text.push(body ? `${head}\n${body}` : head)
	}
	return { text, parts: content.length }
}

export function transcript(ctx: Plugin.Context) {
	const dir = async (sessionID: string) => {
		const pad = (globalThis as any)[Symbol.for("sochinorth.scratchpad")] as
			| { dirs: Map<string, string>; queue?: Promise<void>; prepare?: (ctx: Plugin.Context, sessionID: string) => Promise<void> }
			| undefined
		if (!pad || !SESSION_ID.test(sessionID)) return
		let root = pad.dirs.get(sessionID)
		if (!root || !existsSync(root)) await pad.prepare?.(ctx, sessionID)
		await pad.queue
		root = pad.dirs.get(sessionID)
		if (!root) return
		const path = join(root, "transcripts", sessionID)
		mkdirSync(join(path, "log"), { recursive: true, mode: 0o700 })
		return path
	}

	// the next T number: one past the highest on disk
	const write = (path: string, text: string) => {
		let n = Math.max(0, ...readdirSync(path).map((f) => Number(/^T(\d+)\.out$/.exec(f)?.[1] ?? 0)))
		for (;;) {
			const anchor = `T${String(++n).padStart(4, "0")}`
			const file = join(path, `${anchor}.out`)
			try {
				writeFileSync(file, text, { ...PRIVATE, flag: "wx" })
			} catch (e: any) {
				if (e?.code === "EEXIST") continue
				throw e
			}
			return { anchor, file }
		}
	}

	// A state.json that can't be read starts over: the log only repeats a stretch,
	// the checkpoint loses one step's injection.
	const load = (path: string) => {
		const file = join(path, "state.json")
		let state = shared.states.get(file)
		if (!state) {
			try {
				state = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as State) : {}
			} catch (e) {
				console.error("compaction: transcript", file, e)
				state = {}
			}
			shared.states.set(file, state)
		}
		return state
	}
	// replaced whole, so a crash mid-write leaves the old one
	const store = (path: string) => {
		const file = join(path, "state.json")
		writeFileSync(`${file}.tmp`, JSON.stringify(load(path)), PRIVATE)
		renameSync(`${file}.tmp`, file)
	}

	const segment = (path: string, n: number) => join(path, "log", `${String(n).padStart(4, "0")}.md`)
	const append = (path: string, n: number, text: string[]) => {
		if (text.length === 0) return
		const file = segment(path, n)
		const header = existsSync(file) ? [] : [`# transcript, segment ${n}${n > 1 ? `: from checkpoint ${n - 1}` : ""}`]
		appendFileSync(file, printable([...header, ...text].join("\n\n") + "\n\n"), PRIVATE)
	}

	const update = async (sessionID: string) => {
		const path = await dir(sessionID)
		if (!path) return
		const messages = (await ctx.session.context({ sessionID })) as any[]
		const state = load(path)
		const cursor = (state.cursor ??= { segment: 1 })
		const first = messages[0]
		if (first?.type === "compaction" && first.status === "completed" && first.id !== cursor.compaction) {
			// the history since the last sync went with it; the compaction hook syncs first
			append(path, cursor.segment, [`## checkpoint ${cursor.segment} · ${at(first.time?.created)}\n${first.summary || NATIVE}`])
			Object.assign(cursor, { segment: cursor.segment + 1, compaction: first.id, message: undefined, parts: undefined, logged: [] })
			state.leaves = []
		}
		// Inline, or written whole and pointed at. A read of the transcript's own
		// files isn't written again under a new number.
		const output = (text: string, tool: string, input?: unknown) => {
			const bytes = Buffer.byteLength(text)
			const read = tool === "read" ? (input as any)?.path : undefined
			if (bytes <= LEAF_BYTES || (typeof read === "string" && resolve(read).startsWith(resolve(path) + sep))) return clip(text, LEAF_BYTES)
			const { anchor, file } = write(path, unnul(text))
			;(state.leaves ??= []).push({ anchor, tool, input: brief(input), bytes })
			return `→ ${anchor} (${size(bytes)}): ${file}\n${clip(text.split("\n", 1)[0], 200)}`
		}
		const text: string[] = []
		const place = () => messages.findIndex((m) => m.id === cursor.message)
		// a cursor saved without the list: everything up to it counts as logged
		cursor.logged ??= messages.slice(0, place() + 1).map((m) => m.id)
		if (cursor.message && place() < 0) {
			const logged = new Set(cursor.logged)
			const kept = messages.findLast((m) => logged.has(m.id) && m.type !== "idle" && m.type !== "compaction")
			text.push(
				`## reverted · ${at(Date.now())}\n` +
					(kept ? `The messages above logged after ${at(kept.time?.created)} were undone.` : "The messages above, back to the start of this segment, were undone."),
			)
			cursor.message = kept?.id
			cursor.parts = kept?.type === "assistant" ? kept.content.length : 1
		}
		const newest = messages.findLastIndex((m) => m.type !== "idle" && m.type !== "compaction")
		for (let i = Math.max(place(), 0); i < messages.length; i++) {
			const m = messages[i]
			if (m.type === "compaction") continue
			const from = m.id === cursor.message ? (cursor.parts ?? 0) : 0
			const logged = entries(m, from, i === newest, output)
			text.push(...logged.text)
			if (m.id !== cursor.message) cursor.logged.push(m.id)
			cursor.message = m.id
			cursor.parts = Math.max(from, logged.parts)
			if (m.type === "assistant" && logged.parts < (m.content ?? []).length) break
		}
		append(path, cursor.segment, text)
		store(path)
	}

	return {
		/** The session's transcript directory, created; undefined until its scratchpad is known. */
		dir,
		/** Brings the current log segment up to date with ctx.session.context(). Idempotent. */
		sync(sessionID: string) {
			const next = Promise.resolve(shared.queues.get(sessionID))
				.then(() => update(sessionID))
				.catch((e) => console.error("compaction: transcript", sessionID, e))
			shared.queues.set(sessionID, next)
			return next
		},
		/** The session's state, one object the modules share (each under its own key), or undefined without a transcript. */
		async state(sessionID: string) {
			const path = await dir(sessionID)
			return path ? load(path) : undefined
		},
		/** Writes the session's state after a change. */
		async save(sessionID: string) {
			const path = await dir(sessionID)
			if (path) store(path)
		},
		/** Which of `needles` occur in the log or the large outputs; one pass over the files. Throws without a transcript. */
		async found(sessionID: string, needles: string[]) {
			const path = await dir(sessionID)
			if (!path) throw new Error("no transcript")
			const files = [...readdirSync(join(path, "log")).map((f) => join(path, "log", f)), ...readdirSync(path).filter((f) => f.endsWith(".out")).map((f) => join(path, f))]
			const left = new Set(needles.filter(Boolean))
			const hit = new Set<string>()
			for (const f of files) {
				if (left.size === 0) break
				const text = readFileSync(f, "utf8")
				for (const n of left) if (text.includes(n)) (hit.add(n), left.delete(n))
			}
			return hit
		},
	}
}
