// codex.sale (an OpenAI Responses reseller) as a provider whose models are
// listed live rather than hand-kept in opencode.json.
//
// The API key is the one /connect stores for the codex-sale integration, which
// this plugin registers (so opencode.json needn't mention codex.sale). The
// plugin asks codex.sale's /v1/models with it, and since that only returns IDs,
// takes each model's capabilities, limits and variants from OpenCode's own
// catalog (models.dev) under the provider that owns it (openai/gpt-6.1-sol for
// gpt-6.1-sol); IDs the catalog doesn't know get OpenCode's defaults. Prices
// are left out: they're codex.sale's, not the catalog's.
//
// Refreshes when the credential changes and every 6 hours. The last list and
// the connection it came from are kept in plugin storage, so the models are
// there at startup and offline, and hidden while another key is selected.
//
// OpenCode finds it in ~/.config/opencode/plugins/ on its own. Edits need
// `opencode service restart`: the service caches the module by path, so a
// reload runs the old code.
//
// Options, if the defaults don't fit, in opencode.json:
//   "plugins": [{ "package": "./plugins/codex-sale", "options": { ... } }]
//   owners   upstreams to offer (owned_by in /v1/models). Default ["openai"]:
//            the provider speaks OpenAI Responses. ["*"] offers all it lists.
//   baseURL  default https://codex.sale/v1
import { Model, Plugin, Provider } from "@opencode/plugin"

const PROVIDER = "codex-sale"
const REFRESH_MS = 6 * 60 * 60 * 1000
// /v1/models' owned_by -> catalog providers to look a model up under first
const CATALOG: Record<string, string[]> = {
	openai: ["openai"],
	anthropic: ["anthropic"],
	zhipu: ["zhipuai", "zai"],
	deepseek: ["deepseek"],
}
// not chat models (the catalog files gpt-4o-transcribe under chat too)
const NOT_CHAT = /image|transcribe|tts|whisper|embed|realtime|moderation/

// /v1/models' data, or the stored copy: one entry per string id, in order
const parse = (data: unknown) => {
	if (!Array.isArray(data)) return
	const byID = new Map<string, { id: string; owned_by?: string }>()
	for (const m of data)
		if (typeof m?.id === "string" && m.id && !byID.has(m.id))
			byID.set(m.id, typeof m.owned_by === "string" ? { id: m.id, owned_by: m.owned_by } : { id: m.id })
	return [...byID.values()]
}

// what OpenCode tells connections apart by; undefined for anything that isn't one
const key = (c: any) => {
	const id = c?.type === "credential" ? c.id : c?.type === "env" ? c.name : undefined
	return typeof id === "string" ? `${c.type}:${id}` : undefined
}

export default Plugin.define({
	id: "sochinorth.codex-sale",
	async setup(ctx) {
		let closed = false
		const log = (e: unknown) => closed || console.error(`codex-sale: ${e instanceof Error ? e.message : String(e)}`)
		const option = <T>(name: string, valid: (v: any) => boolean, fallback: T): T => {
			const v = ctx.options[name]
			if (v === undefined || valid(v)) return v ?? fallback
			log(`options.${name}: invalid; using ${JSON.stringify(fallback)}`)
			return fallback
		}
		const owners = option("owners", (v) => Array.isArray(v) && v.every((x) => typeof x === "string"), ["openai"])
		const baseURL = option("baseURL", (v) => typeof v === "string" && URL.canParse(v), "https://codex.sale/v1").replace(/\/$/, "")
		const providerID = Provider.ID.make(PROVIDER)
		const info: Provider.Info = {
			...Provider.Info.empty(providerID),
			name: "codex.sale",
			integrationID: PROVIDER as Provider.Info["integrationID"],
			activation: "auto",
			package: "@opencode/ai/providers/openai-compatible/responses",
			settings: { baseURL, reasoningEffort: "medium", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
		}

		let listed = parse(await ctx.storage.get("listed")) ?? []
		// the connection the list came from: OpenCode hides it while another is selected
		let source: Awaited<ReturnType<typeof ctx.integration.connection.active>>
		const stored = await ctx.storage.get("source")
		if (key(stored)) source = stored as typeof source

		const controller = new AbortController()
		const load = async () => {
			const connection = await ctx.integration.connection.active(PROVIDER)
			if (!connection) return
			const credential = await ctx.integration.connection.resolve(connection)
			if (credential?.type !== "key") return
			const res = await fetch(`${baseURL}/models`, {
				headers: { authorization: `Bearer ${credential.key}` },
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
			})
			if (!res.ok) throw new Error(`GET /models: HTTP ${res.status}`)
			// a body without a data array is an error, not an empty list
			const fresh = parse((await res.json())?.data)
			if (!fresh) throw new Error("GET /models: no data array")
			// switched mid-fetch: the rerun the switch queued lists the new key's models
			if (closed || key(await ctx.integration.connection.active(PROVIDER)) !== key(connection)) return
			if (JSON.stringify(fresh) === JSON.stringify(listed) && key(source) === key(connection)) return
			listed = fresh
			source = connection
			await ctx.storage.set("listed", listed)
			await ctx.storage.set("source", source)
			if (!closed) await ctx.provider.reload()
		}
		// one load at a time, so an older one can't land last; calls during one
		// coalesce into a single rerun after it
		let running = false
		let again = false
		const refresh = async () => {
			again = true
			if (running) return
			running = true
			while (again && !closed) {
				again = false
				await load().catch(log)
			}
			running = false
		}

		// the integration /connect stores the key under (opencode.json declaring the
		// provider would create it too; here nothing else does)
		await ctx.integration.transform((editor) => {
			editor.method.update({ integrationID: PROVIDER, method: { type: "key", label: "codex.sale API key" } })
		})

		await ctx.provider.transform((editor) => {
			const models: Model.Info[] = []
			for (const { id, owned_by: owner = "" } of listed) {
				if (!owners.includes("*") && !owners.includes(owner)) continue
				const known = [...(CATALOG[owner] ?? []).map((p) => editor.get(p)), ...editor.list()]
					.find((r) => r?.models.has(id))
					?.models.get(id)
				if (NOT_CHAT.test(id) || (known?.type ?? "chat") !== "chat") continue
				const base: Model.Info = Model.Info.default(providerID, Model.ID.make(id))
				const { name, family, capabilities, variants, time, status, limit } = known ?? base
				models.push({ ...base, name, family, capabilities, variants, time, status, limit })
			}
			// replaces the record, keeping the provider if opencode.json declares it too
			editor.add({ info: editor.get(PROVIDER)?.provider ?? info, models, sourceConnection: source })
		})

		// the first fetch doesn't hold up startup; the stored list serves meanwhile
		void refresh()
		void (async () => {
			const types = ["credential.switched", "credential.updated", "integration.updated"] as const
			for await (const _ of ctx.event.subscribe({ types, signal: controller.signal })) void refresh()
		})().catch(log)
		const timer = setInterval(refresh, REFRESH_MS)

		return () => {
			closed = true
			controller.abort()
			clearInterval(timer)
		}
	},
})
