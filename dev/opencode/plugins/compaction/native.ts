// Native compaction: OpenAI models on a Responses route that can compact get
// settings.compaction native, unless they set one themselves. The provider
// writes an encrypted checkpoint and the model writes the readable index too
// (checkpoint.ts). An encrypted checkpoint replays only to its own model, so on
// a switch to another one the session is compacted again with that index as the
// summary. A model whose native compaction is refused switches to summary
// compaction for good.
import type { Plugin } from "@opencode/plugin"
import type { Work } from "./checkpoint"
import type { Transcript } from "./transcript"

// Responses routes that implement compaction (route.compact in OpenCode), and
// the models that do it: OpenAI's. Others behind the same route (opencode-go's
// grok) answer it with an error.
const PACKAGES = new Set(["@opencode/ai/providers/openai/responses", "@opencode/ai/providers/azure/responses"])
const FAMILY = /^(gpt|o\d|codex)/i

export const ref = (model: { providerID: string; id: string }) => `${model.providerID}/${model.id}`

/** The session's state.json field: the latest native checkpoint's readable index; `id`, its compaction message, once that compaction has ended. */
export type NativeState = { model: string; index: string; id?: string }
type Mine = { native?: NativeState }

// A native compaction the provider refused, rather than one that hit a limit,
// a timeout or an outage (opencode-go answers 422 "Endpoint is unavailable").
const unsupported = (error: any) =>
	error?.type === "provider.unsupported-operation" ||
	error?.status === 501 ||
	(error?.status >= 400 &&
		error?.status < 500 &&
		![408, 409, 413, 429].includes(error.status) &&
		!/overflow|context|too long|too large|maximum/i.test(`${error.type} ${error.message}`))

// "provider/model" whose native compaction was refused, for every location's instance
const shared: { off?: Set<string> } = ((globalThis as any)[Symbol.for("sochinorth.compaction.native")] ??= {})

/** Makes models native and returns the handlers of the session events native compaction follows. */
export async function native(ctx: Plugin.Context, t: Transcript, work: (sessionID: string) => Work, log: (...args: unknown[]) => void) {
	const off = (shared.off ??= new Set(((await ctx.storage.get("native-off")) as string[] | undefined) ?? []))
	// what this location's transform made native
	const made = new Set<string>()
	await ctx.model.transform((editor) => {
		made.clear()
		for (const model of editor.list()) {
			const source = editor.provider.get(model.providerID)?.provider
			const key = ref(model)
			if (!PACKAGES.has(model.package ?? source?.package ?? "") || off.has(key)) continue
			if (!FAMILY.test(model.family ?? model.id)) continue
			if (model.settings?.compaction ?? source?.settings?.compaction) continue
			editor.update(model.providerID, model.id, (m) => {
				m.settings = { ...m.settings, compaction: { type: "native" } }
			})
			made.add(key)
		}
	})
	const state = (sessionID: string) => t.state(sessionID) as Promise<Mine | undefined>

	return {
		/** A compaction ended: the native checkpoint its index stands for now exists. */
		async ended(sessionID: string) {
			const s = await state(sessionID)
			if (!s?.native || s.native.id) return
			const [first] = await ctx.session.context({ sessionID })
			s.native.id = first?.type === "compaction" ? first.id : undefined
			await t.save(sessionID)
		},
		/** Another model was picked: its history skips the native checkpoint, so its index is recorded instead. */
		async selected(sessionID: string, model: { providerID: string; id: string }) {
			const s = await state(sessionID)
			const n = s?.native
			if (!s || !n?.id || n.model === ref(model) || work(sessionID).port) return
			// what came after the checkpoint stays as the recent tail, while that
			// checkpoint is still the session's latest
			const history = await ctx.session.context({ sessionID })
			if (history[0]?.id !== n.id) return void ((s.native = undefined), await t.save(sessionID))
			// OpenCode keeps no tail from a marker message (idle, model-switched)
			const keepID = history.slice(1).find((m) => m.type === "user" || m.type === "assistant")?.id
			work(sessionID).port = { index: n.index, keepID }
			log(sessionID, `porting the native checkpoint's index to ${ref(model)}, tail from`, keepID)
			await ctx.session.compact({ sessionID, delivery: "queue" })
		},
		/** A compaction failed, its leftovers already cleared: a refused native one is retried as summary compaction. */
		async failed(sessionID: string, error: any) {
			if (!unsupported(error)) return
			const session = await ctx.session.get({ sessionID }).catch(() => undefined)
			const key = session?.model && ref(session.model)
			if (!key || !made.has(key)) return
			// every location's instance rebuilds its models; the first one also
			// records it and compacts the session again
			const first = !off.has(key)
			off.add(key)
			await ctx.model.reload()
			if (!first) return
			log(`${key}: native compaction refused (${error.message}); using summary compaction`)
			await ctx.storage.set("native-off", [...off])
			await ctx.session.compact({ sessionID })
		},
	}
}
