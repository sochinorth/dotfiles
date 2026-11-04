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
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { readdir } from "node:fs/promises"
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

// plugins run in process, where a failed call rejects with the tagged error itself
const notFound = (e: any) => e?._tag === "Session.NotFoundError"

// Plugin instances in other locations share the process: share what they know.
const state: { ready: Map<string, Promise<string | void>>; queue?: Promise<void> } = ((globalThis as any)[Symbol.for("sochinorth.scratchpad")] ??= { ready: new Map() })

// the root of sessionID's subagent tree, whose scratchpad it uses
async function owner(ctx: Plugin.Context, sessionID: string) {
	const seen = new Set<string>()
	let info = await ctx.session.get({ sessionID })
	while (info.parentID) {
		if (seen.has(info.id)) throw new Error(`parentID cycle at ${info.id}`)
		seen.add(info.id)
		info = await ctx.session.get({ sessionID: info.parentID })
	}
	// session IDs are only checked for their "ses" prefix; this one becomes a path
	if (!SESSION_ID.test(info.id)) throw new Error(`unexpected session ID ${JSON.stringify(info.id)}`)
	return info
}

// resolves to the scratchpad's path
async function ensure(ctx: Plugin.Context, sessionID: string) {
	const root = await owner(ctx, sessionID)
	const dir = join(ROOT, root.id)
	// a fork of a subagent forks the scratchpad that subagent used
	const from = root.fork && (await owner(ctx, root.fork.sessionID).then((s) => join(ROOT, s.id), (e) => (notFound(e) ? undefined : Promise.reject(e))))
	const source = from && existsSync(from) ? from : undefined
	if (!existsSync(dir))
		try {
			if (source) cpSync(source, dir, { recursive: true, verbatimSymlinks: true })
			else mkdirSync(dir, { recursive: true })
		} catch (e) {
			rmSync(dir, { recursive: true, force: true })
			throw e
		}
	const subagent = root.id !== sessionID
	const text = [
		`Your scratchpad: ${dir}`,
		subagent
			? "It belongs to the session that started you, shared with its subagents, and lasts as long as that session."
			: "It belongs to this session, shared with its subagents, and lasts as long as the session: it survives restarts and compaction, and is deleted with it.",
		"Use it in place of /tmp, /tmp/opencode, or any other scratchpad or temporary directory named elsewhere.",
		...(source && !subagent
			? [`This session is a fork: it started with a copy of ${source}, so earlier messages' paths under that directory now mean the same paths under this one.`]
			: []),
	].join("\n")
	const entries = await ctx.session.instructions.entry.list({ sessionID })
	if (entries.find((e) => e.key === KEY)?.value !== text) await ctx.session.instructions.entry.put({ sessionID, key: KEY, value: text })
	return dir
}

function prepare(ctx: Plugin.Context, sessionID: string) {
	let ready = state.ready.get(sessionID)
	if (!ready) {
		ready = ensure(ctx, sessionID).catch((e) => {
			state.ready.delete(sessionID)
			console.error(LOG, sessionID, e)
		})
		state.ready.set(sessionID, ready)
	}
	// remade if something deleted it while its session lives
	return ready
		.then((dir) => {
			if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
		})
		.catch((e) => console.error(LOG, sessionID, e))
}

// scratchpads of sessions OpenCode reports as not found; any other answer keeps one
async function sweep(ctx: Plugin.Context, only?: string) {
	for (const id of only ? [only] : await readdir(ROOT).catch(() => [])) {
		if (!SESSION_ID.test(id) || !existsSync(join(ROOT, id))) continue
		try {
			await ctx.session.get({ sessionID: id })
		} catch (e) {
			if (!notFound(e)) console.error(LOG, `keeping ${id}:`, e)
			else {
				rmSync(join(ROOT, id), { recursive: true, force: true })
				state.ready.delete(id)
			}
		}
	}
}

export default Plugin.define({
	id: "sochinorth.scratchpad",
	async setup(ctx) {
		const run = (only?: string) => {
			state.queue = Promise.resolve(state.queue).then(() => sweep(ctx, only)).catch((e) => console.error(LOG, e))
		}
		// once per process
		if (!state.queue) run()

		// before a prompt is admitted, so the first step already sees the entry
		await ctx.session.hook("prompt", (event) => prepare(ctx, event.sessionID))
		await ctx.session.hook("context", (event) => {
			// sessions that start without a prompt (some subagents) get it from their next step
			void prepare(ctx, event.sessionID)
			event.system.forEach((part, i) => {
				const text = part.text.replace(TMP_HINT, "")
				if (text !== part.text) event.system[i] = { ...part, text }
			})
		})

		const controller = new AbortController()
		void (async () => {
			for await (const event of ctx.event.subscribe({ types: ["session.deleted"], signal: controller.signal })) {
				// subagents' entries too: the sweep only sees owners' directories
				state.ready.delete(event.data.sessionID)
				run(event.data.sessionID)
			}
		})().catch((e) => console.error(LOG, e))
		return () => controller.abort()
	},
})
