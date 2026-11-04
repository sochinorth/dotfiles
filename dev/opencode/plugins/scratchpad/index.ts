// A scratchpad per session: a directory that lasts exactly as long as the session.
//
// OpenCode itself only offers /tmp/opencode, one directory for every session,
// which the system's /tmp cleaner ages out. Here each session gets
// $XDG_STATE_HOME/opencode/scratchpad/<sessionID>/. Its subagents share it (they're
// deleted with it), a fork starts with a copy of its source's, and it's deleted
// with its session (at load too, for sessions deleted while this wasn't running).
//
// The model learns the path from a session instruction entry (`scratchpad`).
// Unlike system prompt edits, those reach Claude Agent sessions too: that provider
// replaces OpenCode's environment block with Claude Code's own, which names
// another scratchpad, so the entry says this one replaces it. For the other
// providers, the environment block's hint to prefer /tmp/opencode is removed.
//
// Edits need `opencode service restart`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"

const KEY = "scratchpad"
const LOG = "scratchpad:"
const ROOT = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "opencode", "scratchpad")
// OpenCode's environment block: "Prefer /tmp/opencode over generic system temporary
// directories such as /tmp; it is pre-created and approved for external access."
const TMP_HINT = /^[ \t]*Prefer \S+ over generic system temporary directories\b.*\n?/m
const SESSION_ID = /^ses_[A-Za-z0-9]+$/

type Info = { id: string; parentID?: string; fork?: { sessionID: string } }
type Ctx = {
	session: {
		get(input: { sessionID: string }): Promise<Info>
		instructions: {
			entry: {
				list(input: { sessionID: string }): Promise<readonly { key: string; value: unknown }[]>
				put(input: { sessionID: string; key: string; value: unknown }): Promise<void>
			}
		}
	}
}

// Session.NotFoundError in process (SessionNotFoundError over HTTP)
function notFound(e: unknown): boolean {
	for (let c: any = e; c; c = c.cause) if (/^Session\.?NotFoundError$/.test(c._tag)) return true
	return false
}

function describe(dir: string, subagent: boolean, forkedFrom?: string): string {
	const lines = [
		`Your scratchpad: ${dir}`,
		subagent
			? "It belongs to the session that started you, shared with its subagents, and lasts as long as that session."
			: "It belongs to this session, shared with its subagents, and lasts as long as the session: it survives restarts and compaction, and is deleted with it.",
		"Use it in place of /tmp, /tmp/opencode, or any other scratchpad or temporary directory named elsewhere.",
	]
	if (forkedFrom)
		lines.push(`This session is a fork: it started with a copy of ${forkedFrom}, so earlier messages' paths under that directory now mean the same paths under this one.`)
	return lines.join("\n")
}

// Plugin instances in other locations share the process: share what they know.
const state = ((globalThis as any)[Symbol.for("sochinorth.scratchpad")] ??= {
	ready: new Map<string, Promise<void>>(),
	loaded: false,
	queue: Promise.resolve(),
}) as { ready: Map<string, Promise<void>>; loaded: boolean; queue: Promise<void> }

async function ensure(ctx: Ctx, sessionID: string) {
	let owner = await ctx.session.get({ sessionID })
	while (owner.parentID) owner = await ctx.session.get({ sessionID: owner.parentID })
	const dir = join(ROOT, owner.id)
	const source = owner.fork && SESSION_ID.test(owner.fork.sessionID) ? join(ROOT, owner.fork.sessionID) : undefined
	const copied = source !== undefined && existsSync(source)
	if (!existsSync(dir)) {
		if (copied) cpSync(source, dir, { recursive: true, verbatimSymlinks: true })
		else mkdirSync(dir, { recursive: true })
	}
	const text = describe(dir, owner.id !== sessionID, copied ? source : undefined)
	const entries = await ctx.session.instructions.entry.list({ sessionID })
	if (entries.find((e) => e.key === KEY)?.value !== text) await ctx.session.instructions.entry.put({ sessionID, key: KEY, value: text })
}

function prepare(ctx: Ctx, sessionID: string): Promise<void> {
	let ready = state.ready.get(sessionID)
	if (!ready) {
		ready = ensure(ctx, sessionID).catch((e) => {
			state.ready.delete(sessionID)
			console.error(LOG, sessionID, e)
		})
		state.ready.set(sessionID, ready)
	}
	return ready
}

// scratchpads of sessions OpenCode reports as not found; any other answer keeps one
async function sweep(ctx: Ctx, only?: string) {
	let names: string[] = []
	try {
		names = only ? [only] : readdirSync(ROOT)
	} catch {
		return
	}
	for (const id of names) {
		if (!SESSION_ID.test(id) || !existsSync(join(ROOT, id))) continue
		try {
			await ctx.session.get({ sessionID: id })
		} catch (e) {
			if (!notFound(e)) {
				console.error(LOG, `keeping ${id}:`, e)
				continue
			}
			rmSync(join(ROOT, id), { recursive: true, force: true })
			state.ready.delete(id)
		}
	}
}

export default Plugin.define({
	id: "sochinorth.scratchpad",
	async setup(ctx) {
		const run = (only?: string) => {
			state.queue = state.queue.then(() => sweep(ctx, only)).catch((e) => console.error(LOG, e))
		}
		if (!state.loaded) {
			state.loaded = true
			run()
		}

		// before a prompt is admitted, so the first step already sees the entry
		await ctx.session.hook("prompt", async (event) => {
			await prepare(ctx, event.sessionID)
		})
		await ctx.session.hook("context", async (event) => {
			// sessions that start without a prompt (some subagents) get it from their next step
			void prepare(ctx, event.sessionID)
			for (const part of event.system) if (part.type === "text") part.text = part.text.replace(TMP_HINT, "")
		})

		const controller = new AbortController()
		void (async () => {
			for await (const event of ctx.event.subscribe({ types: ["session.deleted"], signal: controller.signal }))
				run(event.data.sessionID)
		})().catch(() => {})
		return () => controller.abort()
	},
})
