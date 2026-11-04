// Deletes the Claude Code transcripts OpenCode no longer needs.
//
// OpenCode's Claude Agent provider resumes each session from Claude's own
// transcript (<claude dir>/projects/<cwd>/<id>.jsonl), so the transcript has to
// live as long as its session; OpenCode never deletes it afterwards, nor its
// record linking the two (the provider's plugin storage, `sessions/<sessionID>`
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
// directly. It deletes nothing, and logs why, if the record format changes or
// the database isn't this server's (OpenCode names it by release channel): the
// server must know the database's newest session, and a session is gone only
// if both say so.
//
// Every OpenCode running Claude shares the Claude dir, and one with another
// database would see this one's transcripts as orphans. So orphans are only
// removed when the database and the Claude dir are both the default or both
// overridden (OPENCODE_DB, XDG_DATA_HOME; CLAUDE_CONFIG_DIR).
//
// Runs on every `session.deleted` (children of a deleted session get their own
// event) and once when the server loads it. Edits need `opencode service restart`.
import { Database } from "bun:sqlite"
import { closeSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { Plugin } from "@opencode/plugin"

const GRACE_MS = 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LOG = "claude-transcripts:"
const DATA = join(homedir(), ".local", "share")
const CLAUDE = join(homedir(), ".claude")
// plugin storage keys are `plugin:<id as UTF-16 hex>:<key>`
const PREFIX = `plugin:${[..."opencode.provider.claude-agent"].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}:sessions/`

// server plugins get the in-process API, which rejects with the error itself
const notFound = (e: any) => e?._tag === "Session.NotFoundError"

function ls(dir: string) {
	try {
		return readdirSync(dir, { withFileTypes: true })
	} catch {
		return []
	}
}

// Claude session IDs that a running claude process holds
function openSessions(dir: string) {
	const open = new Set<string>()
	for (const { name } of ls(dir)) {
		if (!name.endsWith(".json")) continue
		try {
			const { pid, sessionId } = JSON.parse(readFileSync(join(dir, name), "utf8"))
			try {
				process.kill(pid, 0)
			} catch (e: any) {
				if (e.code !== "EPERM") continue // EPERM: it exists, under another user
			}
			open.add(sessionId)
		} catch {}
	}
	return open
}

// The entrypoint Claude recorded. It ends the first user line, after the
// message, so a large first message (an image) pushes it far in.
function entrypoint(file: string) {
	const buf = Buffer.alloc(64 * 1024)
	const fd = openSync(file, "r")
	try {
		let text = ""
		for (let pos = 0, n; pos < 1024 * 1024 && (n = readSync(fd, buf, 0, buf.length, pos)); pos += n) {
			text = text.slice(-64) + buf.toString("latin1", 0, n)
			const match = /"entrypoint":"([^"]*)"/.exec(text)
			if (match) return match[1]
		}
	} finally {
		closeSync(fd)
	}
}

async function sweep(ctx: Plugin.Context) {
	const name = process.env.OPENCODE_DB ?? "opencode.db"
	if (name === ":memory:") return
	const path = resolve(process.env.XDG_DATA_HOME || DATA, "opencode", name)
	const db = new Database(path, { readwrite: true, strict: true })
	try {
		db.exec("PRAGMA busy_timeout = 5000")
		const newest = db.query("SELECT id FROM session_v2 ORDER BY time_created DESC LIMIT 1").get() as { id: string } | null
		if (!newest) return
		await ctx.session.get({ sessionID: newest.id }).catch((e) => {
			throw notFound(e) ? new Error(`${path} isn't this server's database; not touching anything`) : e
		})

		const rows = db.query("SELECT key, value FROM kv WHERE substr(key, 1, length($prefix)) = $prefix").all({ prefix: PREFIX })
		const all = (rows as { key: string; value: string }[]).map(({ key, value }) => {
			const claude = JSON.parse(value)?.claudeSessionID
			if (claude !== undefined && (typeof claude !== "string" || !UUID.test(claude)))
				throw new Error(`unexpected record format under ${key}; not touching anything`)
			return { key, sessionID: key.slice(PREFIX.length), claude }
		})
		// a session is gone only if OpenCode and its database say so; any other answer keeps it
		const known = db.query("SELECT 1 FROM session_v2 WHERE id = $id")
		const gone = new Set<string>()
		for (const r of all) {
			try {
				await ctx.session.get({ sessionID: r.sessionID })
			} catch (e) {
				if (!notFound(e)) console.error(LOG, `keeping ${r.sessionID}:`, e)
				else if (known.get({ id: r.sessionID })) throw new Error(`${path} has ${r.sessionID}, unlike this server; not touching anything`)
				else gone.add(r.sessionID)
			}
		}

		const dir = process.env.CLAUDE_CONFIG_DIR || CLAUDE
		const orphans = (path === join(DATA, "opencode", "opencode.db")) === (resolve(dir) === CLAUDE)
		if (!orphans && !state.warned) {
			state.warned = true
			console.log(LOG, `${path} and ${dir} aren't both the default or both overridden; only removing what records name`)
		}
		const open = openSessions(join(dir, "sessions"))
		const live = new Set(all.filter((r) => !gone.has(r.sessionID)).map((r) => r.claude))
		const doomed = new Set(all.filter((r) => gone.has(r.sessionID)).map((r) => r.claude))
		const now = Date.now()
		let removed = 0
		for (const project of ls(join(dir, "projects"))) {
			if (!project.isDirectory()) continue
			const base = join(dir, "projects", project.name)
			for (const { name } of ls(base)) {
				const id = name.slice(0, -".jsonl".length)
				if (!name.endsWith(".jsonl") || !UUID.test(id) || live.has(id) || open.has(id)) continue
				const file = join(base, name)
				try {
					if (!doomed.has(id) && (!orphans || now - statSync(file).mtimeMs < GRACE_MS || entrypoint(file) !== "opencode")) continue
				} catch {
					continue // gone or unreadable since the listing
				}
				rmSync(join(base, id), { recursive: true, force: true }) // its subagent transcripts, tool output
				rmSync(file, { force: true })
				removed++
			}
		}

		// records whose transcript is still open wait for a later sweep
		const drop = all.filter((r) => gone.has(r.sessionID) && !(r.claude && open.has(r.claude))).map((r) => r.key)
		db.query("DELETE FROM kv WHERE key IN (SELECT value FROM json_each($keys))").run({ keys: JSON.stringify(drop) })
		if (removed || drop.length) console.log(LOG, `removed ${removed} transcript(s), ${drop.length} record(s) of gone sessions`)
	} finally {
		db.close()
	}
}

// Plugin instances in other locations share the process (and these files):
// sweeps run one at a time, at most one waits (deleting a session tree is one
// event per session), and the one at load runs only once.
const state = ((globalThis as any)[Symbol.for("sochinorth.claude-transcripts")] ??= {
	loaded: false,
	waiting: false,
	warned: false,
	queue: Promise.resolve(),
})

export default Plugin.define({
	id: "sochinorth.claude-transcripts",
	setup(ctx) {
		const run = () => {
			if (state.waiting) return
			state.waiting = true
			state.queue = state.queue.then(async () => {
				state.waiting = false
				await sweep(ctx).catch((e) => console.error(LOG, e))
			})
		}
		if (!state.loaded) {
			state.loaded = true
			run()
		}

		const controller = new AbortController()
		void (async () => {
			for await (const _ of ctx.event.subscribe({ types: ["session.deleted"], signal: controller.signal })) run()
		})().catch((e) => controller.signal.aborted || console.error(LOG, e))
		return () => controller.abort()
	},
})
