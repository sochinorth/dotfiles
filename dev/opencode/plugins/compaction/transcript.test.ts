// bun test plugins/compaction, from dev/opencode
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { transcript } from "./transcript"

const SESSION = "ses_test"
const roots: string[] = []
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// A transcript over a history the test changes between syncs, as a session's does.
function session() {
	const root = mkdtempSync(join(tmpdir(), "transcript-test-"))
	roots.push(root)
	;(globalThis as any)[Symbol.for("sochinorth.scratchpad")] = { dirs: new Map([[SESSION, root]]) }
	const history = { messages: [] as any[] }
	const t = transcript({ options: {}, session: { context: async () => history.messages } } as any)
	const dir = join(root, "transcripts", SESSION)
	return {
		t,
		history,
		dir,
		log: (segment = 1) => readFileSync(join(dir, "log", `${String(segment).padStart(4, "0")}.md`), "utf8"),
		outputs: () => readdirSync(dir).filter((f) => f.endsWith(".out")),
		sync: () => t.sync(SESSION),
	}
}

let clock = 1_000_000
const user = (id: string, text: string) => ({ id, type: "user", text, time: { created: ++clock } })
const reply = (id: string, text: string) => ({ id, type: "assistant", content: [{ type: "text", text }], time: { created: ++clock } })
const occurrences = (text: string, needle: string) => text.split(needle).length - 1
const expectOrder = (text: string, needles: string[]) => {
	const places = needles.map((needle) => text.indexOf(needle))
	expect(places).toEqual(places.toSorted((a, b) => a - b))
}

describe("the log's cursor", () => {
	test("logs every message of a fork, whose IDs end in an unpadded sequence number", async () => {
		const s = session()
		const seqs = [9, 95, 106, 998, 1017, 2614]
		for (const n of seqs) {
			s.history.messages.push(reply(`msg_base_${n}`, `reply-${n}.`))
			await s.sync()
		}
		for (const n of seqs) expect(occurrences(s.log(), `reply-${n}.`)).toBe(1)
		expectOrder(s.log(), seqs.map((n) => `reply-${n}.`))
	})

	test("logs a whole fork seen in one sync, and doesn't repeat it in the next", async () => {
		const s = session()
		const seqs = [95, 106, 998, 1017]
		s.history.messages.push(...seqs.map((n) => reply(`msg_base_${n}`, `reply-${n}.`)))
		await s.sync()
		await s.sync()
		for (const n of seqs) expect(occurrences(s.log(), `reply-${n}.`)).toBe(1)
		expectOrder(s.log(), seqs.map((n) => `reply-${n}.`))
	})

	test("logs a queued message admitted after a message with a newer ID", async () => {
		const s = session()
		s.history.messages.push(reply("msg_b", "the reply."))
		await s.sync()
		s.history.messages.push(user("msg_a", "the queued prompt."))
		await s.sync()
		s.history.messages.push(reply("msg_c", "the next reply."))
		await s.sync()
		const log = s.log()
		expect(occurrences(log, "the queued prompt.")).toBe(1)
		expect(occurrences(log, "the next reply.")).toBe(1)
		expect(log.indexOf("the queued prompt.")).toBeLessThan(log.indexOf("the next reply."))
	})

	test("after a revert, repeats only what was undone and logs what follows", async () => {
		const s = session()
		const kept = [reply("msg_base_9", "reply-9."), reply("msg_base_99", "reply-99.")]
		s.history.messages.push(...kept, reply("msg_base_100", "reply-100."))
		await s.sync()
		s.history.messages = [...kept, user("msg_new", "after the revert.")]
		await s.sync()
		const log = s.log()
		expect(log).toContain("## reverted")
		expect(occurrences(log, "reply-9.")).toBe(1)
		expect(occurrences(log, "reply-99.")).toBe(1)
		expect(occurrences(log, "after the revert.")).toBe(1)
		expect(log.indexOf("## reverted")).toBeLessThan(log.indexOf("after the revert."))
	})

	test("after a revert of a whole turn, repeats nothing that stayed", async () => {
		const s = session()
		const kept = [user("msg_a", "first prompt."), reply("msg_b", "first reply.")]
		s.history.messages.push(...kept)
		await s.sync()
		s.history.messages.push(user("msg_c", "second prompt."))
		await s.sync()
		s.history.messages.push(reply("msg_d", "second reply."))
		await s.sync()
		s.history.messages = [...kept]
		await s.sync()
		const log = s.log()
		expect(log).toContain("## reverted")
		expect(occurrences(log, "first prompt.")).toBe(1)
		expect(occurrences(log, "first reply.")).toBe(1)
	})

	test("after a revert, logs a new message even if the clock stepped back behind the undone one", async () => {
		const s = session()
		const at = (message: any, created: number) => ({ ...message, time: { created } })
		const kept = at(reply("msg_a", "kept."), 100)
		s.history.messages.push(kept, at(reply("msg_b", "undone."), 200))
		await s.sync()
		s.history.messages = [kept, at(user("msg_c", "after the clock step."), 150)]
		await s.sync()
		expect(occurrences(s.log(), "kept.")).toBe(1)
		expect(occurrences(s.log(), "after the clock step.")).toBe(1)
	})

	test("takes over a cursor saved without its list of logged messages", async () => {
		const s = session()
		mkdirSync(join(s.dir, "log"), { recursive: true })
		writeFileSync(join(s.dir, "state.json"), JSON.stringify({ cursor: { segment: 1, message: "msg_c", parts: 1 } }))
		writeFileSync(join(s.dir, "log", "0001.md"), "first reply.\n\nsecond reply.\n\nthird reply.\n\n")
		const kept = reply("msg_a", "first reply.")
		const cursor = reply("msg_c", "third reply.")
		s.history.messages = [kept, reply("msg_b", "second reply."), cursor]
		await s.sync()
		expect(s.log()).not.toContain("## reverted")
		expect(occurrences(s.log(), "third reply.")).toBe(1)
		s.history.messages = [kept, user("msg_d", "after the revert.")]
		await s.sync()
		expect(occurrences(s.log(), "first reply.")).toBe(1)
		expect(occurrences(s.log(), "after the revert.")).toBe(1)
	})

	test("adds a running tool's result to its message once, when it finishes", async () => {
		const s = session()
		const tool = { type: "tool", name: "shell", state: { status: "running", input: { command: "true" } } }
		const message = { id: "msg_base_100", type: "assistant", content: [{ type: "text", text: "starting." }, tool], time: { created: ++clock } }
		s.history.messages.push(message)
		await s.sync()
		expect(s.log()).not.toContain("the tool's output.")
		message.content[1] = { ...tool, state: { status: "completed", input: { command: "true" }, content: [{ type: "text", text: "the tool's output." }] } }
		await s.sync()
		await s.sync()
		const log = s.log()
		expect(occurrences(log, "starting.")).toBe(1)
		expect(occurrences(log, "the tool's output.")).toBe(1)
	})

	test("starts a new segment after a compaction, with the old cursor gone", async () => {
		const s = session()
		s.history.messages.push(reply("msg_base_998", "before."))
		await s.sync()
		s.history.messages = [
			{ id: "msg_c", type: "compaction", status: "completed", summary: "the summary.", time: { created: ++clock } },
			reply("msg_base_1017", "after."),
		]
		await s.sync()
		expect(s.log(1)).toContain("the summary.")
		expect(s.log(1)).not.toContain("## reverted")
		expect(s.log(2)).toContain("after.")
	})
})

describe("large reads", () => {
	const read = (id: string, path: string, text: string) => ({
		id,
		type: "assistant",
		content: [{ type: "tool", name: "read", state: { status: "completed", input: { path }, content: [{ type: "text", text }] } }],
		time: { created: ++clock },
	})
	const large = `the start.\n${"x".repeat(5000)}\nthe end.`

	test("a read of this session's own transcript isn't written again", async () => {
		const s = session()
		s.history.messages.push(read("msg_a", join(s.dir, "log", "0001.md"), large))
		await s.sync()
		expect(s.outputs()).toHaveLength(0)
	})

	test("a read of another session's transcript is written whole", async () => {
		const s = session()
		s.history.messages.push(read("msg_a", join(s.dir, "..", "ses_other", "T0001.out"), large))
		await s.sync()
		expect(s.outputs()).toHaveLength(1)
		expect(await s.t.found(SESSION, ["the end."])).toEqual(new Set(["the end."]))
	})

	test("numbers a new output past those already on disk", async () => {
		const s = session()
		mkdirSync(s.dir, { recursive: true })
		writeFileSync(join(s.dir, "T0007.out"), "earlier")
		s.history.messages.push(read("msg_a", "/elsewhere/file", large))
		await s.sync()
		expect(s.outputs().toSorted()).toEqual(["T0007.out", "T0008.out"])
		expect(readFileSync(join(s.dir, "T0007.out"), "utf8")).toBe("earlier")
	})
})

describe("synthetic messages", () => {
	const synthetic = (id: string, description: string, text: string) => ({ id, type: "synthetic", description, text, time: { created: ++clock } })

	test("a short one's text can be searched for, beside its description", async () => {
		const s = session()
		s.history.messages.push(synthetic("msg_a", "Sol review, round 1", "the report's finding."))
		await s.sync()
		expect(await s.t.found(SESSION, ["the report's finding.", "Sol review, round 1", "absent"])).toEqual(new Set(["the report's finding.", "Sol review, round 1"]))
	})

	test("a large one is written whole, once, however many syncs follow", async () => {
		const s = session()
		const text = `the report's start.\n${"x".repeat(5000)}\nthe report's end.`
		s.history.messages.push(synthetic("msg_a", "Sol review, round 1", text))
		await s.sync()
		await s.sync()
		await s.sync()
		expect(s.outputs()).toHaveLength(1)
		expect(readFileSync(join(s.dir, s.outputs()[0]), "utf8")).toBe(text)
		expect(s.log()).not.toContain("the report's end.")
		expect(await s.t.found(SESSION, ["the report's end."])).toEqual(new Set(["the report's end."]))
		expect((await s.t.state(SESSION))?.leaves).toHaveLength(1)
	})

	test("one with only a description still leaves an entry", async () => {
		const s = session()
		s.history.messages.push({ id: "msg_a", type: "synthetic", description: "a label.", time: { created: ++clock } })
		await s.sync()
		expect(s.log()).toContain("a label.")
	})

	test("a system message still logs only its description", async () => {
		const s = session()
		s.history.messages.push({ id: "msg_a", type: "system", description: "Instructions updated", text: "the whole instructions.", time: { created: ++clock } })
		await s.sync()
		expect(s.log()).toContain("Instructions updated")
		expect(s.log()).not.toContain("the whole instructions.")
		expect(s.outputs()).toHaveLength(0)
	})
})
