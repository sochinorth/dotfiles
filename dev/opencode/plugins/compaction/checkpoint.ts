// The checkpoint, level 1 of the transcript tree: what a compaction leaves in
// context, an index into the transcript (transcript.ts). Without a transcript
// (the scratchpad isn't known yet) OpenCode compacts on its own.
//
// Summary compaction: the model writes the index from prompt.ts (Must know, and
// a Map of grep keys, each checked against the transcript), asked for with
// ctx.session.generate so it reuses the turns' cached prefix; no recent tail
// beside it. A failed or malformed reply leaves OpenCode's summary.
//
// Native compaction (native.ts): the provider writes an encrypted checkpoint,
// steered by a last message about the transcript, and the model writes the
// readable index too, for a switch to another model.
//
// After either, every later request gets what after.ts builds, right after the
// checkpoint and so cache-stable. Injected, not stored: a message admitted
// mid-run would reach the model a step late.
//
// /compact <text>: instructions for the index, or for the native steering message.
import { createHash } from "node:crypto"
import type { Plugin } from "@opencode/plugin"
import { after, type After } from "./after"
import { native, ref, type NativeState } from "./native"
import * as Prompt from "./prompt"
import { textOf, type State, type Transcript } from "./transcript"

const LOG = "compaction:"
// output cap for the index request (Claude Code's for its summary)
const INDEX_TOKENS = 20_000
const GENERATE_TIMEOUT = 10 * 60_000
const MISSING = " (not in transcript)"

const hash = (text: string) => createHash("sha256").update(text).digest("base64url").slice(0, 22)

// A user message for a request's history. Plugins can't import OpenCode's
// message class, but the history's messages are instances of it.
const userMessage = (like: any, text: string) =>
	typeof like?.constructor?.user === "function" ? like.constructor.user(text) : { role: "user", content: [{ type: "text", text }] }

// the session's state.json fields this module and native.ts keep; `anchor`
// tells which checkpoint the current block follows
type Mine = State & {
	after?: { current?: After & { anchor: string }; pending?: After & { summary?: string } }
	native?: NativeState
	notice?: string
}

/** A session's compaction under way, or about to be: what the hooks hand each other. */
export type Work = {
	focus?: string // /compact instructions
	reason?: string // the running compaction's: "auto" or "manual"
	maxTokens?: number // of the index request, while it runs
	port?: { index: string; keepID?: string } // the index the next compaction records, after a model switch
}

// A plugin instance per location, one process, every event to each: work is
// shared here, so the command's instance and the session's see the same.
const shared: { work?: Map<string, Work>; notices?: Map<string, Promise<void>> } = ((globalThis as any)[Symbol.for("sochinorth.compaction.checkpoint")] ??= {})
const works = (shared.work ??= new Map())
const notices = (shared.notices ??= new Map())
const work = (sessionID: string) => works.get(sessionID) ?? (works.set(sessionID, {}), works.get(sessionID)!)
// drops a session's entry once nothing is under way, unless it was replaced meanwhile
const settle = (sessionID: string, w = works.get(sessionID)) => {
	if (w && works.get(sessionID) === w && Object.values(w).every((v) => v === undefined)) works.delete(sessionID)
}

// Marks each backticked key in the Map (outside code blocks) that the
// transcript doesn't contain. A transcript that can't be read leaves it unmarked.
const unescape = (key: string) => key.replace(/\\(.)/g, "$1")
async function verify(text: string, found: (keys: string[]) => Promise<Set<string>>) {
	const at = Prompt.mapAt(text)
	if (at < 0) return text
	// inline code with backslash escapes in it, and whether it's marked already
	const key = /`((?:[^`\n\\]|\\.)+)`( \(not in transcript\))?/g
	const pieces = text.slice(at).split(/(```[\s\S]*?(?:```|$))/)
	const keys = [...new Set(pieces.flatMap((p, i) => (i % 2 ? [] : [...p.matchAll(key)].flatMap((m) => (m[2] ? [] : [unescape(m[1])])))))]
	const hit = await found(keys).catch(() => undefined)
	if (!hit) return text
	return text.slice(0, at) + pieces.map((p, i) => (i % 2 ? p : p.replace(key, (m, k, marked) => (!marked && !hit.has(unescape(k)) ? m + MISSING : m)))).join("")
}

// Where a request's history opens with a checkpoint: OpenCode's summary (one
// user message) or a native window (user messages, then the provider's
// checkpoint). The anchor tells checkpoints apart.
function opening(messages: readonly any[]): { index: number; anchor: string } | undefined {
	const first = messages[0]
	if (first?.role === "user") {
		const text = textOf(first.content)
		if (text.startsWith("<conversation-checkpoint>")) return { index: 0, anchor: hash(text) }
	}
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i]
		if (m?.role === "user") continue
		const item = m?.role === "assistant" && Array.isArray(m.content) ? m.content.find((c: any) => c?.type === "compaction") : undefined
		return item ? { index: i, anchor: item.id ?? hash(String(item.encrypted ?? item.text ?? "")) } : undefined
	}
}

/** Registers the compaction's hooks, /compact and its event subscription; returns their teardown. */
export async function checkpoint(ctx: Plugin.Context, t: Transcript, options: { native?: boolean } = {}) {
	const log = (...args: unknown[]) => console.error(LOG, ...args)
	const nativeEvents = await native(ctx, t, work, log, options.native !== false)
	const state = (sessionID: string) => t.state(sessionID) as Promise<Mine | undefined>

	// Keep a small durable marker visible in the UI without storing the full
	// refmap in conversation history or causing another model turn.
	const notice = async (sessionID: string) => {
		const [first] = await ctx.session.context({ sessionID })
		if (first?.type !== "compaction" || first.status !== "completed") return
		const key = `${sessionID}:${first.id}`
		const existing = notices.get(key)
		if (existing) return existing
		const run = (async () => {
			const s = await state(sessionID)
			if (!s || s.notice === first.id) return
			const dir = await t.dir(sessionID)
			if (!dir) return
			const marker = Prompt.notice(dir)
			await ctx.session.synthetic({
				sessionID,
				text: marker.text,
				description: marker.description,
				delivery: "queue",
				resume: false,
			})
			s.notice = first.id
			await t.save(sessionID)
		})()
		notices.set(key, run)
		try {
			await run
		} finally {
			if (notices.get(key) === run) notices.delete(key)
		}
	}

	// puts the text after the checkpoint it followed
	const inject = async (sessionID: string, messages: any[]) => {
		const at = opening(messages)
		if (!at) return
		const s = await state(sessionID)
		const a = s?.after
		if (!a) return
		// the first request after a compaction: its checkpoint is new
		if (a.pending && at.anchor !== a.current?.anchor) {
			const { summary, ...pending } = a.pending
			if (summary === undefined || textOf(messages[at.index].content).includes(summary)) {
				s.after = { current: { ...pending, anchor: at.anchor } }
				await t.save(sessionID)
			}
		}
		const current = s.after?.current
		if (current?.anchor === at.anchor && current.text) messages.splice(at.index + 1, 0, userMessage(messages[at.index], current.text))
	}

	await ctx.session.hook("context", (event) => inject(event.sessionID, event.messages))
	await ctx.session.hook("generate", async (event) => {
		await inject(event.sessionID, event.messages)
		const max = works.get(event.sessionID)?.maxTokens
		if (max) event.options.maxTokens = max
	})

	// the model's index of the conversation, keys verified; undefined when it fails
	const index = async (sessionID: string, dir: string, instructions: string | undefined, output: number | undefined) => {
		let reply: string | undefined
		const w = work(sessionID)
		w.maxTokens = Math.min(output || INDEX_TOKENS, INDEX_TOKENS)
		try {
			// a second try when the reply lacks the two sections
			for (let attempt = 0; attempt < 2 && !reply; attempt++) {
				const { text } = await ctx.session.generate({ sessionID, prompt: Prompt.request(dir, instructions) }, { signal: AbortSignal.timeout(GENERATE_TIMEOUT) })
				reply = Prompt.summary(text)
			}
			if (!reply) log(sessionID, "no Must know and Map in the index reply")
		} catch (e) {
			log(sessionID, "index request failed:", e)
		} finally {
			w.maxTokens = undefined
			settle(sessionID, w)
		}
		return reply && verify(reply, (keys) => t.found(sessionID, keys))
	}

	await ctx.session.hook("compaction", async (event) => {
		const sessionID = event.sessionID
		const w = work(sessionID)
		const { focus: instructions, port } = w
		w.focus = w.port = undefined
		// an automatic compaction runs before the step's context hook: log the last step first
		await t.sync(sessionID)
		const dir = await t.dir(sessionID)
		const s = await state(sessionID)
		if (!dir || !s) return
		await inject(sessionID, event.messages)
		const earlier = s.after?.current?.files ?? []
		const { directory } = (await ctx.session.get({ sessionID })).location
		const models = await ctx.model.list({ location: { directory } })
		const model = models.data.find((m) => m.providerID === event.model.providerID && m.id === event.model.id)
		const reply = port?.index ?? (await index(sessionID, dir, instructions, model?.limit.output))
		const next = async (index?: string) => after(directory, dir, await ctx.session.context({ sessionID }), s.leaves ?? [], earlier, index)

		if (!port && model?.settings?.compaction?.type === "native") {
			// last, where the provider's compaction takes over (the system prompt didn't steer it)
			event.messages.push(userMessage(event.messages.at(-1), Prompt.native(dir, instructions)))
			s.native = reply ? { model: ref(event.model), index: reply } : undefined
			s.after = { ...s.after, pending: await next(reply) }
			return void (await t.save(sessionID))
		}
		s.native = undefined
		if (!reply) {
			// OpenCode writes the summary; the note, facts and files still follow it
			log(sessionID, "using OpenCode's summary")
			s.after = { ...s.after, pending: await next() }
			return void (await t.save(sessionID))
		}

		const summary = [Prompt.HEADER, "", reply, ...(works.get(sessionID)?.reason === "auto" ? ["", Prompt.RESUME] : [])].join("\n")
		// OpenCode puts its own keepID under this metadata; null keeps no tail
		event.result = { summary, metadata: { keepID: port?.keepID ?? null, ...(instructions ? { instructions } : {}) } }
		s.after = { ...s.after, pending: { ...(await next()), summary } }
		await t.save(sessionID)
	})

	await ctx.command.transform((editor) => {
		editor.add({
			name: "compact",
			description: "compact the session; any text after it is what the checkpoint should focus on",
			execute: async ({ sessionID, prompt, delivery }) => {
				work(sessionID).focus = prompt.text.trim() || undefined
				settle(sessionID)
				await ctx.session.compact({ sessionID, delivery })
			},
		})
	})

	const types = ["session.compaction.started", "session.compaction.ended", "session.compaction.failed", "session.model.selected", "session.deleted"] as const
	type Event = { type: (typeof types)[number]; data: any }
	const handle = async ({ type, data }: Event) => {
		const { sessionID } = data
		if (type === "session.compaction.started") return void (work(sessionID).reason = data.reason)
		const w = works.get(sessionID)
		if (w) w.reason = undefined
		if (type === "session.deleted") return void works.delete(sessionID)
		if (type === "session.model.selected") await nativeEvents.selected(sessionID, data.model)
		else if (type === "session.compaction.ended") {
			await nativeEvents.ended(sessionID)
			await notice(sessionID)
		}
		else {
			// failed: what it would have left is void
			if (w) w.port = undefined
			const s = await state(sessionID)
			if (s?.after?.pending || (s?.native && !s.native.id)) {
				if (s.after) s.after.pending = undefined
				if (s.native && !s.native.id) s.native = undefined
				await t.save(sessionID)
			}
			await nativeEvents.failed(sessionID, data.error)
		}
		settle(sessionID)
	}

	const controller = new AbortController()
	void (async () => {
		for await (const event of ctx.event.subscribe({ types: [...types], signal: controller.signal })) await handle(event as Event).catch(log)
	})().catch((e) => controller.signal.aborted || log(e))
	return () => controller.abort()
}
