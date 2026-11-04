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
// left alone unless a gone session's record names them; a `claude` started in
// an OpenCode terminal isn't standalone (see plugins/claude-entrypoint).
//
// That storage is private to the provider, so this reads OpenCode's database
// directly. It deletes nothing, and logs why, if the record format changes or
// the database isn't this server's (OpenCode names it by release channel): a
// value this plugin stores through the server must show up in it, and a
// session is gone only if both say so.
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

const PLUGIN = "sochinorth.claude-transcripts"
const GRACE_MS = 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LOG = "claude-transcripts:"
const DATA = join(homedir(), ".local", "share")
const CLAUDE = join(homedir(), ".claude")
// Plugin storage namespaces encode the plugin ID as UTF-16 hex.
const storageKey = (plugin: string, key: string) =>
	`plugin:${plugin.split("").map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}:${key}`
const PREFIX = storageKey("opencode.provider.claude-agent", "sessions/")
const PROBE = "database-probe"

function ls(dir: string) {
	try {
		return readdirSync(dir, { withFileTypes: true })
	} catch {
		return []
	}
}

function openSessions(dir: string) {
	const open = new Set<string>()
	for (const { name } of ls(dir)) {
		if (!name.endsWith(".json")) continue
		try {
			const { pid, sessionId } = JSON.parse(readFileSync(join(dir, name), "utf8"))
			try {
				process.kill(pid, 0)
			} catch (e: any) {
				if (e.code !== "EPERM") continue // EPERM: alive, under another user
			}
			open.add(sessionId)
		} catch {}
	}
	return open
}

// The tag follows the first user message, which may contain a large image.
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
		// No busy timeout: synchronous waits block the server's own writers.
		// A busy DB fails this sweep; a later one retries.
		const probe = crypto.randomUUID()
		await ctx.storage.set(PROBE, probe)
		try {
			const found = db.query("SELECT 1 FROM kv WHERE key = $key AND value = $value").get({ key: storageKey(PLUGIN, PROBE), value: JSON.stringify(probe) })
			if (!found) throw new Error(`${path} isn't this server's database; not touching anything`)
		} finally {
			await ctx.storage.remove(PROBE)
		}

		const rows = db.query("SELECT key, value FROM kv WHERE substr(key, 1, length($prefix)) = $prefix").all({ prefix: PREFIX })
		const all = (rows as { key: string; value: string }[]).map(({ key, value }) => {
			const claude = JSON.parse(value)?.claudeSessionID
			if (typeof claude !== "string" || !UUID.test(claude))
				throw new Error(`unexpected record format under ${key}; not touching anything`)
			return { key, sessionID: key.slice(PREFIX.length), claude, gone: false }
		})
		const known = db.query("SELECT 1 FROM session_v2 WHERE id = $id")
		for (const r of all) {
			try {
				await ctx.session.get({ sessionID: r.sessionID })
			} catch (e: any) {
				// In-process calls reject with the tagged error itself; anything else keeps it.
				if (e?._tag !== "Session.NotFoundError") console.error(LOG, `keeping ${r.sessionID}:`, e)
				else if (known.get({ id: r.sessionID })) throw new Error(`${path} has ${r.sessionID}, unlike this server; not touching anything`)
				else r.gone = true
			}
		}

		const dir = process.env.CLAUDE_CONFIG_DIR || CLAUDE
		const orphans = (path === join(DATA, "opencode", "opencode.db")) === (resolve(dir) === CLAUDE)
		if (!orphans && !state.warned) {
			state.warned = true
			console.log(LOG, `${path} and ${dir} aren't both the default or both overridden; only removing what records name`)
		}
		const open = openSessions(join(dir, "sessions"))
		const live = new Set(all.filter((r) => !r.gone).map((r) => r.claude))
		const doomed = new Set(all.filter((r) => r.gone).map((r) => r.claude))
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
				rmSync(join(base, id), { recursive: true, force: true })
				rmSync(file, { force: true })
				removed++
			}
		}
		const drop = all.filter((r) => r.gone && !open.has(r.claude)).map((r) => r.key)
		db.query("DELETE FROM kv WHERE key IN (SELECT value FROM json_each($keys))").run({ keys: JSON.stringify(drop) })
		if (removed || drop.length) console.log(LOG, `removed ${removed} transcript(s), ${drop.length} record(s) of gone sessions`)
	} finally {
		db.close()
	}
}

// Locations share one runner and at most one waiting sweep, including the probe.
const state = ((globalThis as any)[Symbol.for(PLUGIN)] ??= {
	loaded: false,
	waiting: false,
	warned: false,
	queue: Promise.resolve(),
})

export default Plugin.define({
	id: PLUGIN,
	setup(ctx) {
		const run = () => {
			if (state.waiting) return
			state.waiting = true
			state.queue = state.queue.then(() => {
				state.waiting = false
				return sweep(ctx).catch((e) => console.error(LOG, e))
			})
		}
		if (!state.loaded) run()
		state.loaded = true
		const controller = new AbortController()
		void (async () => {
			for await (const _ of ctx.event.subscribe({ types: ["session.deleted"], signal: controller.signal })) run()
		})().catch((e) => controller.signal.aborted || console.error(LOG, e))
		return () => controller.abort()
	},
})
