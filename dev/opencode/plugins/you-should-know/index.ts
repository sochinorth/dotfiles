// A side agent reads the session every few steps of a long turn, and once more
// when such a turn ends, since what's worth knowing often only exists by then.
// When it finds something the person should know but probably missed, it offers
// it above the prompt (gui/gui.tsx). Modelled on Claude Code's "You should know",
// which has no check at the end of a turn.
//
// The check is ctx.session.generate, which sees the session's history without
// touching it, and runs beside the next step. It sends every tool along, which
// keeps the prompt cache, so it has to run at a step boundary: with an unfinished
// instruction last in history the model answers with a tool call and no text.
// Those calls are not executed. The empty reply reads as nothing to say, and the
// next check tries again.
//
// Checks spend the session's own model, so only sessions a window has open get
// them (scripted sessions don't), and ignored offers back it off.
//
// What it has offered, what the person knew, the back-off and each session's open
// offer are per project, in one file in the project scratchpad (plugins/scratchpad).
// Deleting the file only makes it forget. Turning suggestions off is a choice about
// all projects, so that alone is in ctx.storage.
//
// Each check, or the reason one didn't run, goes in that file's `checks`: the only
// way to tell a side agent that judged "no" from one that never got asked.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { parse, propose, type Moment } from "./prompt"
import { YouShouldKnow, type Action, type View } from "./rpc"

const CHECK_EVERY_STEPS = 6
// The window asks every few seconds, but a hidden tab's timers can slow to once a minute.
const WATCH_MS = 150_000
// Newest kept, per list: these go into every check's prompt.
const REMEMBERED = 50
// An offer nobody answered is about work long since moved on from.
const OFFER_KEEP_MS = 3 * 24 * 60 * 60 * 1000
// An offer is taken down once this many prompts went past it.
const PROMPTS_TO_IGNORE = 2
// Ignoring this many in a row is free; after that, skip 1, 2, 4... checks.
const FREE_IGNORES = 2
const MAX_SKIPS = 16
// Checks take seconds, but a network outage can hold one for as long as it lasts, blocking its
// session's checks. generate doesn't stop for an abort signal, so this only stops waiting for it.
const CHECK_TIMEOUT_MS = 120_000
const STATE_FILE = "you-should-know.json"
const CHECKS_KEPT = 100

type Stored = View & { prompts: number; shownAt: number }
type Outcome =
	// asked
	| "shown" | "none" | "empty" | "unparsable" | "deduped" | "superseded" | "error"
	// not asked
	| "not_watched" | "offered_this_turn" | "busy" | "off" | "open_offer" | "backoff"
type Check = { at: number; sessionID: string; moment: Moment; step: number; outcome: Outcome; ms?: number; detail?: string }
type State = { views: Record<string, Stored>; seen: string[]; known: string[]; ignored: number; skips: number; checks: Check[] }

const key = (line: string) => line.toLowerCase().replace(/\.$/, "")
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0)
const skipsAfter = (ignored: number) => (ignored <= FREE_IGNORES ? 0 : Math.min(MAX_SKIPS, 2 ** (ignored - FREE_IGNORES - 1)))
const shown = ({ prompts: _prompts, shownAt: _shownAt, ...view }: Stored): View => view
const remember = (lines: string[], line: string) =>
	lines.some((item) => key(item) === key(line)) ? lines : [...lines, line].slice(-REMEMBERED)

const isView = (view: any) =>
	(view?.kind === "offer" || view?.kind === "explained") &&
	(view.tag === "You should know" || view.tag === "Heads up") &&
	[view.line, view.title, view.explanation].every((text) => typeof text === "string")

// The file is in a directory agents can write to, so nothing in it is taken on trust.
function load(file: string): State {
	let raw: any = {}
	try {
		raw = JSON.parse(readFileSync(file, "utf8")) ?? {}
	} catch {}
	const views = Object.entries(raw.views ?? {}).flatMap(([sessionID, view]: [string, any]) =>
		isView(view) ? [[sessionID, { ...view, prompts: count(view.prompts), shownAt: count(view.shownAt) }]] : [],
	)
	return {
		views: Object.fromEntries(views),
		seen: strings(raw.seen),
		known: strings(raw.known),
		ignored: count(raw.ignored),
		skips: count(raw.skips),
		checks: Array.isArray(raw.checks) ? raw.checks.filter((entry: unknown) => typeof entry === "object" && entry !== null) : [],
	}
}

// A session's scratchpad sits beside this file and goes when the session goes, or
// moves when the session moves to another project, so it says whose offers are live.
function groom(state: State, file: string) {
	const now = Date.now()
	for (const [sessionID, view] of Object.entries(state.views)) {
		if (now - view.shownAt > OFFER_KEEP_MS || !existsSync(join(dirname(file), sessionID))) delete state.views[sessionID]
	}
	return state
}

function save(file: string, state: State) {
	const temporary = `${file}.${process.pid}.tmp`
	writeFileSync(temporary, JSON.stringify(state))
	renameSync(temporary, file)
}

export default Plugin.define({
	id: "you-should-know",
	async setup(ctx) {
		// Undefined when the session has no scratchpad: it's gone, or plugins/scratchpad isn't loaded.
		const stateFile = async (sessionID: string) => {
			const pad = (globalThis as any)[Symbol.for("sochinorth.scratchpad")] as
				| { dirs: Map<string, string>; queue?: Promise<void>; prepare?: (ctx: Plugin.Context, sessionID: string) => Promise<void> }
				| undefined
			if (!pad) return
			const known = pad.dirs.get(sessionID)
			if (!known || !existsSync(known)) await pad.prepare?.(ctx, sessionID)
			await pad.queue
			const dir = pad.dirs.get(sessionID)
			// The project scratchpad is the parent of every session scratchpad.
			return dir && join(dirname(dir), STATE_FILE)
		}
		// `change` is synchronous and so is the file work, so concurrent updates can't interleave.
		const update = async <T>(sessionID: string, change: (state: State) => T) => {
			const file = await stateFile(sessionID)
			if (!file) return
			const state = load(file)
			const before = JSON.stringify(state)
			const result = change(groom(state, file))
			if (JSON.stringify(state) !== before) save(file, state)
			return result
		}

		// A session's events and its window's calls all reach the instance of the session's
		// own location, so what this holds is enough. Forgetting it on a reload costs little.
		type Live = { watchedAt: number; steps: number; offered: boolean; checking: boolean; endStep?: number }
		const live = new Map<string, Live>()
		const liveOf = (sessionID: string) => {
			const known = live.get(sessionID)
			if (known) return known
			const created: Live = { watchedAt: 0, steps: 0, offered: false, checking: false }
			live.set(sessionID, created)
			return created
		}

		await ctx.rpc.register(YouShouldKnow, {
			view: async (input) => {
				const { sessionID } = input as { sessionID: string }
				liveOf(sessionID).watchedAt = Date.now()
				const view = await update(sessionID, (state) => state.views[sessionID])
				return { view: view ? shown(view) : null, off: (await ctx.storage.get("off")) === true }
			},
			act: async (input) => {
				const { sessionID, action } = input as { sessionID: string; action: Action }
				const view = await update(sessionID, (state) => {
					const current = state.views[sessionID]
					if (!current) return null
					// Answering at all is what resets the back-off: they're reading these.
					state.ignored = 0
					state.skips = 0
					if (action === "learn") {
						state.views[sessionID] = { ...current, kind: "explained" }
						return shown(state.views[sessionID])
					}
					if (action !== "dismiss") state.known = remember(state.known, current.line)
					delete state.views[sessionID]
					return null
				})
				return { view: view ?? null }
			},
			setOff: async (input) => {
				await ctx.storage.set("off", (input as { off: boolean }).off)
				return {}
			},
		})

		const record = (sessionID: string, entry: Omit<Check, "at" | "sessionID">) =>
			update(sessionID, (state) => {
				state.checks = [...state.checks, { at: Date.now(), sessionID, ...entry }].slice(-CHECKS_KEPT)
			})

		// One check. It's separate from the event loop so that the loop never waits on a model.
		const check = async (sessionID: string, moment: Moment, step: number) => {
			const session = liveOf(sessionID)
			session.checking = true
			const started = Date.now()
			let outcome: Outcome = "error"
			let detail: string | undefined
			try {
				const before = await update(sessionID, (state) => state)
				if (!before) return
				const { text } = await Promise.race([
					ctx.session.generate({ sessionID: sessionID as any, prompt: propose(before.seen, before.known, moment) }),
					new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), CHECK_TIMEOUT_MS)),
				])
				const proposal = parse(text)
				if (proposal === "none" || !proposal) {
					outcome = proposal ?? (text.trim() === "" ? "empty" : "unparsable")
					if (outcome === "unparsable") detail = text.slice(0, 300)
					return
				}
				detail = proposal.line
				outcome =
					(await update(sessionID, (state): Outcome => {
						if (state.views[sessionID]) return "superseded"
						if ([...state.seen, ...state.known].some((line) => key(line) === key(proposal.line))) return "deduped"
						state.seen = remember(state.seen, proposal.line)
						state.views[sessionID] = { kind: "offer", prompts: 0, shownAt: Date.now(), ...proposal }
						return "shown"
					})) ?? "error"
				if (outcome === "shown") session.offered = true
			} catch (error) {
				detail = String(error)
				console.error("you-should-know: check failed", sessionID, error)
			} finally {
				session.checking = false
				await record(sessionID, { moment, step, outcome, ms: Date.now() - started, detail }).catch((error) => console.error("you-should-know: can't record a check", sessionID, error))
				const { endStep } = session
				session.endStep = undefined
				if (endStep !== undefined) void attempt(sessionID, "turn_end", endStep).catch((error) => console.error("you-should-know: turn-end check failed", sessionID, error))
			}
		}

		// Checks the session if nothing stands in the way.
		const attempt = async (sessionID: string, moment: Moment, step: number) => {
			const session = liveOf(sessionID)
			const skip = (outcome: Outcome) => record(sessionID, { moment, step, outcome })
			if (Date.now() - session.watchedAt > WATCH_MS) return skip("not_watched")
			if (session.offered) return skip("offered_this_turn")
			if (session.checking) {
				// That check can't see the turn's last message, which is what this one is for.
				if (moment === "turn_end") session.endStep = step
				else await skip("busy")
				return
			}
			if ((await ctx.storage.get("off")) === true) return skip("off")
			const blocked = await update(sessionID, (state): Outcome | undefined => {
				if (state.views[sessionID]) return "open_offer"
				if (state.skips === 0) return
				state.skips = Math.min(MAX_SKIPS, state.skips) - 1
				return "backoff"
			})
			if (blocked) return skip(blocked)
			void check(sessionID, moment, step)
		}

		const onStep = async (sessionID: string) => {
			const session = liveOf(sessionID)
			session.steps += 1
			if (session.steps % CHECK_EVERY_STEPS === 0) await attempt(sessionID, "step", session.steps)
		}

		// Only work long enough to have been checked along the way gets one at its end. Starting
		// over here keeps each subagent reporting back from buying another check.
		const onFinished = async (sessionID: string) => {
			const session = liveOf(sessionID)
			const { steps } = session
			if (steps < CHECK_EVERY_STEPS) return
			session.steps = 0
			await attempt(sessionID, "turn_end", steps)
		}

		// The person is back. An offer left open for long enough goes away and counts against showing more.
		const onPrompt = async (sessionID: string) => {
			const session = liveOf(sessionID)
			session.steps = 0
			session.offered = false
			session.endStep = undefined
			await update(sessionID, (state) => {
				const view = state.views[sessionID]
				if (view?.kind !== "offer") return
				const prompts = view.prompts + 1
				if (prompts < PROMPTS_TO_IGNORE) {
					state.views[sessionID] = { ...view, prompts }
					return
				}
				delete state.views[sessionID]
				state.ignored += 1
				state.skips = skipsAfter(state.ignored)
			})
		}

		// An execution starting isn't the person prompting: a subagent reporting back or a compaction
		// starts one, and a prompt sent mid-run joins the running one. Inbox items tell them apart.
		const types = ["session.execution.succeeded", "session.inbox.enqueued", "session.step.ended", "session.deleted"] as const
		const controller = new AbortController()
		void (async () => {
			for await (const event of ctx.event.subscribe({ types: [...types], signal: controller.signal })) {
				const { sessionID } = event.data
				try {
					if (event.type === "session.deleted") {
						live.delete(sessionID)
						continue
					}
					if (event.type === "session.step.ended" && event.data.finish !== "tool-calls") continue
					if (event.type === "session.inbox.enqueued" && event.data.item.type !== "user") continue
					// Every location's instance sees every event, and execution events carry no location,
					// so the session's own decides. An event's location just saves the others the lookup.
					if (event.location && event.location.directory !== ctx.location.directory) continue
					const session = await ctx.session.get({ sessionID })
					if (session.parentID || session.location?.directory !== ctx.location.directory) continue
					if (event.type === "session.step.ended") await onStep(sessionID)
					else if (event.type === "session.execution.succeeded") await onFinished(sessionID)
					else await onPrompt(sessionID)
				} catch (error) {
					console.error("you-should-know:", event.type, sessionID, error)
				}
			}
			if (!controller.signal.aborted) console.error("you-should-know: event stream ended")
		})().catch((error) => {
			if (!controller.signal.aborted) console.error("you-should-know: event stream failed", error)
		})
		return () => controller.abort()
	},
})
