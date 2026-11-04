// codex.sale (an OpenAI Responses reseller) as a provider whose models are
// listed live rather than hand-kept in opencode.json.
//
// It registers the codex-sale integration, so /connect stores a key for it and
// opencode.json needn't mention codex.sale. With the selected key it asks
// /v1/models, which only returns IDs, and takes each model's capabilities,
// limits and variants from OpenCode's own catalog (models.dev), under the
// provider that owns it first; IDs the catalog doesn't know get OpenCode's
// defaults. Prices are left out: they're codex.sale's, not the catalog's.
// Image models (gpt-image-*) are offered too, as image models for
// experimental_image_generate; other non-chat models are left out.
//
// Refreshes when the credential changes and every 6 hours. The last list is
// stored with the connection it came from, so the models are there at startup
// and offline, and hidden while another key is selected.
//
// OpenCode finds it in ~/.config/opencode/plugins/ on its own. Edits need
// `opencode service restart`: the service caches the module by path.
//
// Options, in opencode.json:
//   "plugins": [{ "package": "./plugins/codex-sale", "options": { ... } }]
//   owners   owned_by values to offer. Default ["openai"]: the provider speaks
//            OpenAI Responses. ["*"] offers all it lists.
//   baseURL  an http(s) URL, default https://codex.sale/v1
import { Model, Plugin, Provider } from "@opencode/plugin"

const PROVIDER = "codex-sale"
// /v1/models' owned_by -> preferred catalog providers
const CATALOG = new Map<string, string[]>([
	["openai", ["openai"]],
	["anthropic", ["anthropic"]],
	["zhipu", ["zhipuai", "zai"]],
	["deepseek", ["deepseek"]],
])
// The catalog files some non-chat models (e.g. gpt-4o-transcribe) under chat.
const NOT_CHAT = /image|transcribe|tts|whisper|embed|realtime|moderation/
// Image models, by type, or by name when the catalog doesn't know the ID. They
// go through OpenAI's Images API (/images/generations, /images/edits), which
// codex.sale serves too.
const IMAGE = /^(gpt-image|chatgpt-image|dall-e)/
const IMAGES_PACKAGE = "@opencode/ai/providers/openai/images"

// API or cached data: keep the first entry per nonempty string id, in order.
const parse = (data: unknown) => {
	if (!Array.isArray(data)) return
	const byID = new Map<string, { id: string; owned_by?: string }>()
	for (const m of data)
		if (typeof m?.id === "string" && m.id && !byID.has(m.id))
			byID.set(m.id, typeof m.owned_by === "string" ? { id: m.id, owned_by: m.owned_by } : { id: m.id })
	return [...byID.values()]
}

// OpenCode's connection identity; metadata changes don't change the key.
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
		const baseURL = option("baseURL", (v) => typeof v === "string" && /^https?:\/\//.test(v) && URL.canParse(v), "https://codex.sale/v1").replace(/\/$/, "")
		const providerID = Provider.ID.make(PROVIDER)
		const info: Provider.Info = {
			...Provider.Info.empty(providerID),
			name: "codex.sale",
			integrationID: PROVIDER as Provider.Info["integrationID"],
			activation: "auto",
			// OpenAI's own route, not the generic openai-compatible one: only it can
			// compact natively, which codex.sale passes through (plugins/compaction
			// turns it on). Over HTTP, as the generic route ran.
			package: "@opencode/ai/providers/openai/responses",
			settings: { baseURL, transport: "http" },
		}
		// Per chat model rather than on the provider: provider settings reach image
		// models too, and the Images route sends them as request body fields.
		const responses = { reasoningEffort: "medium", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] }

		// One stored value keeps list/source paired; ignore lists without provenance.
		type Connection = Awaited<ReturnType<typeof ctx.integration.connection.active>>
		const stored = (await ctx.storage.get("models")) as { listed?: unknown; source?: Connection } | undefined
		let source = key(stored?.source) ? stored?.source : undefined
		let listed = (source && parse(stored?.listed)) || []
		const controller = new AbortController()
		let running = false
		let again = false
		// One runner: calls during a fetch coalesce into one rerun, never race it.
		const refresh = async () => {
			again = true
			if (running) return
			running = true
			while (again && !closed) {
				again = false
				try {
					const connection = await ctx.integration.connection.active(PROVIDER)
					if (!connection) continue
					const credential = await ctx.integration.connection.resolve(connection)
					if (credential?.type !== "key") continue
					const res = await fetch(`${baseURL}/models`, {
						headers: { authorization: `Bearer ${credential.key}` },
						signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
					})
					if (!res.ok) throw new Error(`GET /models: HTTP ${res.status}`)
					const fresh = parse(((await res.json()) as { data?: unknown } | null)?.data)
					if (!fresh) throw new Error("GET /models: no data array") // Not an empty inventory.
					// A switch queues a rerun; don't publish the old connection's result.
					const active = await ctx.integration.connection.active(PROVIDER)
					if (closed || key(active) !== key(connection)) continue
					if (JSON.stringify(fresh) === JSON.stringify(listed) && key(source) === key(connection)) continue
					// Persist before committing in memory, so failed writes remain retryable.
					await ctx.storage.set("models", { listed: fresh, source: connection })
					listed = fresh
					source = connection
					if (!closed) await ctx.provider.reload()
				} catch (e) {
					log(e)
				}
			}
			running = false
		}

		// the integration /connect stores the key under
		await ctx.integration.transform((editor) => {
			editor.method.update({ integrationID: PROVIDER, method: { type: "key", label: "codex.sale API key" } })
		})
		await ctx.provider.transform((editor) => {
			const models: Model.Info[] = []
			for (const { id, owned_by: owner = "" } of listed) {
				if (!owners.includes("*") && !owners.includes(owner)) continue
				const known = [...(CATALOG.get(owner) ?? []).map((p) => editor.get(p)), ...editor.list()]
					.find((r) => r?.models.has(id))?.models.get(id)
				const type = known?.type ?? (IMAGE.test(id) ? "image" : "chat")
				const base: Model.Info = Model.Info.default(providerID, Model.ID.make(id))
				const { name, family, capabilities, variants, time, status, limit } = known ?? base
				if (type === "image")
					// The package is set here, not taken from the catalog: the entry found
					// may be another host's (Azure's, an openai-compatible gateway's).
					models.push({
						...base, type, package: IMAGES_PACKAGE, name, family, time, status, limit, variants: [],
						capabilities: known ? capabilities : { tools: false, input: ["text", "image"], output: ["image"], temperature: false },
					})
				else if (type === "chat" && !NOT_CHAT.test(id))
					models.push({ ...base, name, family, capabilities, variants, time, status, limit, settings: responses })
			}
			// Preserve a configured provider, but bind its inventory too.
			editor.add({ info: editor.get(PROVIDER)?.provider ?? info, models, sourceConnection: source })
		})

		void refresh() // The stored list serves startup while this runs.
		void (async () => {
			const types = ["credential.switched", "credential.updated", "integration.updated"] as const
			for await (const _ of ctx.event.subscribe({ types, signal: controller.signal })) void refresh()
		})().catch(log)
		const timer = setInterval(refresh, 6 * 60 * 60 * 1000)
		return () => {
			closed = true
			controller.abort()
			clearInterval(timer)
		}
	},
})
