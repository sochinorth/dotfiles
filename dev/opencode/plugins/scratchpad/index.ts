// Scratchpads live under $XDG_STATE_HOME/opencode/scratchpad:
//   -home-me-repo/             project workflow state, kept
//   -home-me-repo/<sessionID>/ session output, deleted with its owner
// A worktree is its own project. Subagents share their root session's directory;
// forks copy their source's. Flat session directories migrate on first use.
// The model learns the paths from session instruction entries, which reach Claude
// Agent too (its own Claude Code scratchpad is off: plugins/claude-entrypoint).
// Edits need `opencode service restart`.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { Plugin } from "@opencode/plugin"

const ROOT = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "opencode", "scratchpad")
const KEY = "scratchpad"
const PATHS_KEY = "scratchpad-paths"
const PRIVATE = 0o700
// OpenCode validates only the "ses" prefix; IDs used as paths need more.
const SESSION_ID = /^ses_[A-Za-z0-9]+$/
const MAPPING = /^Earlier messages' paths under (.+) now mean the same paths under (.+)\.$/
// OpenCode's environment block (not Claude Agent's): "Prefer /tmp/opencode over
// generic system temporary directories such as /tmp; ..."
const TMP_HINT = /^[ \t]*Prefer \S+ over generic system temporary directories\b.*\n?/m
const notFound = (e: any) => e?._tag === "Session.NotFoundError"

// All plugin locations share one process. Serialize filesystem changes, cache
// invalidation and instruction writes together so a move cannot race preparation.
const state: {
	dirs: Map<string, string>
	queue?: Promise<void>
	prepare?: (ctx: Plugin.Context, sessionID: string) => Promise<void>
} = ((globalThis as any)[Symbol.for("sochinorth.scratchpad")] ??= { dirs: new Map() })

function enqueue(label: string, task: () => unknown) {
	state.queue = Promise.resolve(state.queue).then(task).then(() => {}, (e) => console.error("scratchpad:", label, e))
	return state.queue
}

function slug(dir: string) {
	const s = dir.replace(/[^a-zA-Z0-9]/g, "-")
	return s.length <= 200 ? s : `${s.slice(0, 200)}-${createHash("sha256").update(dir).digest("hex").slice(0, 12)}`
}

function list(dir: string) {
	try {
		// Cleanup must not descend through project symlinks into unrelated data.
		return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
	} catch {
		return []
	}
}
const projects = () => list(ROOT).filter((name) => name.startsWith("-"))

function locate(sessionID: string) {
	if (!SESSION_ID.test(sessionID)) return []
	return [...projects(), ""].map((p) => join(ROOT, p, sessionID)).filter((dir) => existsSync(dir))
}

async function owner(ctx: Plugin.Context, sessionID: string) {
	const seen = new Set<string>()
	let info = await ctx.session.get({ sessionID })
	while (info.parentID) {
		if (seen.has(info.id)) throw new Error(`parentID cycle at ${info.id}`)
		seen.add(info.id)
		info = await ctx.session.get({ sessionID: info.parentID })
	}
	if (!SESSION_ID.test(info.id)) throw new Error(`unexpected session ID ${JSON.stringify(info.id)}`)
	return info
}

// Read an entry, or replace it only when its value changes.
async function entry(ctx: Plugin.Context, sessionID: string, key: string, value?: string) {
	const old = (await ctx.session.instructions.entry.list({ sessionID })).find((e) => e.key === key)?.value
	if (value === undefined) return typeof old === "string" ? old : ""
	if (old !== value) await ctx.session.instructions.entry.put({ sessionID, key, value })
	return value
}

// Keep historical paths pointing at the contents, including through chained
// moves and forks. A fork reads its source's mappings only when copying files.
async function remap(ctx: Plugin.Context, sessionID: string, from: string, to: string, sourceID = sessionID) {
	const pairs = (await entry(ctx, sourceID, PATHS_KEY)).split("\n").flatMap((line) => {
		const m = MAPPING.exec(line)
		return m ? [[m[1], m[2] === from ? to : m[2]]] : []
	})
	pairs.push([from, to])
	await entry(ctx, sessionID, PATHS_KEY, [...new Set(pairs.map(([a, b]) => `Earlier messages' paths under ${a} now mean the same paths under ${b}.`))].join("\n"))
}

function copy(from: string | undefined, to: string) {
	try {
		if (from) cpSync(from, to, { recursive: true, verbatimSymlinks: true })
		else mkdirSync(to, { mode: PRIVATE })
	} catch (e) {
		rmSync(to, { recursive: true, force: true })
		throw e
	}
}

function move(from: string, to: string) {
	try {
		renameSync(from, to)
	} catch (e: any) {
		if (e?.code !== "EXDEV") throw e
		copy(from, to)
		rmSync(from, { recursive: true, force: true })
	}
}

function prepare(ctx: Plugin.Context, sessionID: string) {
	return enqueue(sessionID, async () => {
		const cached = state.dirs.get(sessionID)
		if (cached) {
			if (!existsSync(cached)) mkdirSync(cached, { recursive: true, mode: PRIVATE })
			return
		}
		const root = await owner(ctx, sessionID)
		const project = join(ROOT, slug(root.location.directory))
		const dir = join(project, root.id)
		if (!existsSync(dir)) {
			mkdirSync(project, { recursive: true, mode: PRIVATE })
			const old = locate(root.id)[0]
			// A fork of a subagent copies the root session's shared scratchpad.
			const source = !old && root.fork
				? await owner(ctx, root.fork.sessionID).catch((e) => (notFound(e) ? undefined : Promise.reject(e)))
				: undefined
			const sourceDir = source && locate(source.id)[0]
			// Publish before changing files: failed writes leave the source intact
			// and the next preparation retries both operations.
			if (old) await remap(ctx, root.id, old, dir)
			else if (source && sourceDir) await remap(ctx, root.id, sourceDir, dir, source.id)
			if (old) move(old, dir)
			else copy(sourceDir, dir)
		}
		const subagent = root.id !== sessionID
		const mappings = subagent && (await entry(ctx, root.id, PATHS_KEY))
		if (mappings) await entry(ctx, sessionID, PATHS_KEY, mappings)
		await entry(ctx, sessionID, KEY, [
			`Project scratchpad: ${project}`,
			`Session scratchpad: ${dir}`,
			"The project scratchpad holds workflow state for work in this directory and outlives sessions, so later sessions and other models find it.",
			`The session scratchpad belongs to ${subagent ? "the session that started you" : "this session"}, is shared with its subagents, survives restarts and compaction, and is deleted with its owner.`,
			"Use them in place of /tmp, /tmp/opencode, or any other scratchpad or temporary directory named elsewhere.",
		].join("\n"))
		state.dirs.set(sessionID, dir)
	})
}

// Only confirmed-missing sessions are removed; project/task directories survive.
async function sweep(ctx: Plugin.Context, only?: string) {
	const dirs = only ? locate(only) : [...projects(), ""].flatMap((p) => list(join(ROOT, p)).map((id) => join(ROOT, p, id)))
	for (const dir of dirs) {
		const id = basename(dir)
		if (!SESSION_ID.test(id) || !existsSync(dir)) continue
		try {
			await ctx.session.get({ sessionID: id })
		} catch (e) {
			if (notFound(e)) rmSync(dir, { recursive: true, force: true })
			else console.error("scratchpad:", `keeping ${dir}:`, e)
		}
	}
}

export default Plugin.define({
	id: "sochinorth.scratchpad",
	async setup(ctx) {
		// Compaction can begin before a prompt hydrates an older session. Let the
		// transcript plugin use the same owner, fork, and path migration logic.
		state.prepare = (context, sessionID) => prepare(context, sessionID)
		if (!state.queue) void enqueue("sweep", () => sweep(ctx))
		await ctx.session.hook("prompt", (event) => prepare(ctx, event.sessionID))
		await ctx.session.hook("context", (event) => {
			// Context-only starts get their entries at the next step boundary.
			void prepare(ctx, event.sessionID)
			event.system.forEach((part, i) => {
				const text = part.text.replace(TMP_HINT, "")
				if (text !== part.text) event.system[i] = { ...part, text }
			})
		})
		const controller = new AbortController()
		void (async () => {
			for await (const event of ctx.event.subscribe({ types: ["session.deleted", "session.moved"], signal: controller.signal })) {
				void enqueue(event.type, () => {
					if (event.type === "session.moved") state.dirs.clear()
					else {
						state.dirs.delete(event.data.sessionID)
						return sweep(ctx, event.data.sessionID)
					}
				})
			}
		})().catch((e) => console.error("scratchpad:", e))
		return () => controller.abort()
	},
})
