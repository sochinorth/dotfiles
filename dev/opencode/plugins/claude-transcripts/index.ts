// Deletes the Claude Code transcripts OpenCode no longer needs.
//
// OpenCode's Claude Agent provider resumes each session from Claude's own
// transcript (<claude dir>/projects/<cwd>/<id>.jsonl), so the transcript has to
// live as long as its session. OpenCode never deletes it afterwards. It also keeps
// its record linking the two (the provider's plugin storage, `sessions/<sessionID>`
// -> { claudeSessionID }). This plugin removes both:
//   - the transcript and record of a session OpenCode reports as not found
//     (deleted now, or while this wasn't running);
//   - transcripts Claude tagged as started from OpenCode that no record points to.
//     Editing or reverting a message forks the transcript, which orphans the
//     old one. They're only removed after an hour, and never while a claude
//     process has them open (a session's first turn is saved to its record only
//     once the turn ends).
// Transcripts from standalone `claude` (or from before the entrypoint tag) are
// left alone unless a gone session's record names them.
//
// That storage is private to the provider, so this reads OpenCode's database
// directly. If the record format changes, it deletes nothing and logs why.
//
// Runs on every `session.deleted` (children of a deleted session get their own
// event) and once when the server loads it. Edits need `opencode service restart`.
import { Database } from "bun:sqlite"
import { closeSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { Plugin } from "@opencode/plugin"

const PROVIDER_PLUGIN = "opencode.provider.claude-agent"
const GRACE_MS = 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LOG = "claude-transcripts:"

type Record = { key: string; sessionID: string; claude?: string }

// plugin storage keys are `plugin:<id as UTF-16 hex>:<key>`
const PREFIX = `plugin:${[...PROVIDER_PLUGIN].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}:sessions/`

function database(): Database | undefined {
	const name = process.env.OPENCODE_DB ?? "opencode.db"
	if (name === ":memory:") return
	const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
	const db = new Database(resolve(join(data, "opencode"), name), { readwrite: true, strict: true })
	db.exec("PRAGMA busy_timeout = 5000")
	return db
}

function records(db: Database): Record[] {
	const rows = db
		.query("SELECT key, value FROM kv WHERE substr(key, 1, length($prefix)) = $prefix")
		.all({ prefix: PREFIX }) as { key: string; value: string }[]
	return rows.map(({ key, value }) => {
		const claude = JSON.parse(value)?.claudeSessionID
		if (claude !== undefined && (typeof claude !== "string" || !UUID.test(claude)))
			throw new Error(`unexpected record format under ${key}; not touching anything`)
		return { key, sessionID: key.slice(PREFIX.length), claude }
	})
}

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")

// Claude session IDs that a running claude process holds
function openSessions(dir: string): Set<string> {
	const open = new Set<string>()
	let names: string[] = []
	try {
		names = readdirSync(join(dir, "sessions"))
	} catch {
		return open
	}
	for (const name of names) {
		if (!name.endsWith(".json")) continue
		try {
			const { pid, sessionId } = JSON.parse(readFileSync(join(dir, "sessions", name), "utf8"))
			process.kill(pid, 0)
			open.add(sessionId)
		} catch {}
	}
	return open
}

// the entrypoint Claude recorded, from the first lines of the transcript
function entrypoint(file: string): string | undefined {
	const buf = Buffer.alloc(64 * 1024)
	const fd = openSync(file, "r")
	try {
		const n = readSync(fd, buf, 0, buf.length, 0)
		return /"entrypoint":"([^"]*)"/.exec(buf.toString("utf8", 0, n))?.[1]
	} finally {
		closeSync(fd)
	}
}

// Session.NotFoundError in process (SessionNotFoundError over HTTP)
function notFound(e: unknown): boolean {
	for (let c: any = e; c; c = c.cause) if (/^Session\.?NotFoundError$/.test(c._tag)) return true
	return false
}

async function sweep(ctx: { session: { get(input: { sessionID: string }): Promise<unknown> } }) {
	const db = database()
	if (!db) return
	try {
		const all = records(db)
		// a session is gone only if OpenCode says so; any other answer keeps it
		const gone = new Set<string>()
		for (const r of all) {
			try {
				await ctx.session.get({ sessionID: r.sessionID })
			} catch (e) {
				if (notFound(e)) gone.add(r.sessionID)
				else console.error(LOG, `keeping ${r.sessionID}:`, e)
			}
		}

		const dir = claudeDir()
		const open = openSessions(dir)
		const keep = new Set(all.flatMap((r) => (r.claude && (!gone.has(r.sessionID) || open.has(r.claude)) ? [r.claude] : [])))
		const doomed = new Set(all.flatMap((r) => (r.claude && gone.has(r.sessionID) && !keep.has(r.claude) ? [r.claude] : [])))
		const now = Date.now()
		let removed = 0
		const projects = join(dir, "projects")
		let dirs: string[] = []
		try {
			dirs = readdirSync(projects, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? [join(projects, d.name)] : []))
		} catch {}
		for (const base of dirs) {
			for (const name of readdirSync(base)) {
				const id = name.slice(0, -".jsonl".length)
				if (!name.endsWith(".jsonl") || !UUID.test(id) || keep.has(id) || open.has(id)) continue
				const file = join(base, name)
				if (!doomed.has(id) && (now - statSync(file).mtimeMs < GRACE_MS || entrypoint(file) !== "opencode")) continue
				rmSync(join(base, id), { recursive: true, force: true }) // its subagent transcripts, tool output
				rmSync(file, { force: true })
				removed++
			}
		}

		// records whose transcript is still open wait for a later sweep
		const drop = all.filter((r) => gone.has(r.sessionID) && !(r.claude && open.has(r.claude)))
		const del = db.prepare("DELETE FROM kv WHERE key = $key")
		db.transaction(() => drop.forEach(({ key }) => del.run({ key })))()
		if (removed || drop.length) console.log(LOG, `removed ${removed} transcript(s), ${drop.length} record(s) of gone sessions`)
	} finally {
		db.close()
	}
}

// Plugin instances in other locations share the process (and these files):
// sweeps run one at a time, and the one at load only once.
const state = ((globalThis as any)[Symbol.for("sochinorth.claude-transcripts")] ??= {
	loaded: false,
	queue: Promise.resolve(),
}) as { loaded: boolean; queue: Promise<void> }

export default Plugin.define({
	id: "sochinorth.claude-transcripts",
	setup(ctx) {
		const run = () => {
			state.queue = state.queue.then(() => sweep(ctx)).catch((e) => console.error(LOG, e))
		}
		if (!state.loaded) {
			state.loaded = true
			run()
		}

		const controller = new AbortController()
		void (async () => {
			for await (const _ of ctx.event.subscribe({ types: ["session.deleted"], signal: controller.signal })) run()
		})().catch(() => {})
		return () => controller.abort()
	},
})
