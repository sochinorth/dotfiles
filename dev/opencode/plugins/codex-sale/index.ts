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
// Refreshes when the credential changes and every 6 hours. The last list is
// kept in plugin storage, so the models are there at startup and offline.
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

type Listed = { id: string; owned_by?: string }

export default Plugin.define({
	id: "sochinorth.codex-sale",
	async setup(ctx) {
		const owners = (ctx.options.owners as string[] | undefined) ?? ["openai"]
		const baseURL = ((ctx.options.baseURL as string | undefined) ?? "https://codex.sale/v1").replace(/\/$/, "")
		const providerID = Provider.ID.make(PROVIDER)
		const info: Provider.Info = {
			...Provider.Info.empty(providerID),
			name: "codex.sale",
			integrationID: PROVIDER as Provider.Info["integrationID"],
			activation: "auto",
			package: "@opencode/ai/providers/openai-compatible/responses",
			settings: {
				baseURL,
				reasoningEffort: "medium",
				reasoningSummary: "auto",
				include: ["reasoning.encrypted_content"],
			},
		}

		let listed = ((await ctx.storage.get("listed")) as Listed[] | undefined) ?? []
		// the connection the list came from: OpenCode hides it while another is selected
		let source: Awaited<ReturnType<typeof ctx.integration.connection.active>>

		let closed = false
		const refresh = async () => {
			const connection = await ctx.integration.connection.active(PROVIDER)
			if (!connection) return
			const credential = await ctx.integration.connection.resolve(connection)
			if (credential?.type !== "key") return
			const res = await fetch(`${baseURL}/models`, {
				headers: { authorization: `Bearer ${credential.key}` },
				signal: AbortSignal.timeout(15_000),
			})
			if (!res.ok) throw new Error(`codex-sale: GET /models: HTTP ${res.status}`)
			const fresh = (((await res.json()) as { data?: Listed[] }).data ?? []).map(({ id, owned_by }) => ({ id, owned_by }))
			if (closed) return
			if (JSON.stringify(fresh) === JSON.stringify(listed) && JSON.stringify(source) === JSON.stringify(connection)) return
			listed = fresh
			source = connection
			await ctx.storage.set("listed", listed)
			await ctx.provider.reload()
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
				const from = [...(CATALOG[owner] ?? []), ...editor.list().map((r) => r.provider.id)]
				const known = from.map((p) => editor.get(p)?.models.get(id)).find((m) => m !== undefined)
				if (NOT_CHAT.test(id) || (known?.type ?? "chat") !== "chat") continue
				const base = Model.Info.default(providerID, Model.ID.make(id))
				if (!known) {
					models.push(base)
					continue
				}
				const { name, family, capabilities, variants, time, status, limit } = known
				models.push({ ...base, name, family, capabilities, variants, time, status, limit })
			}
			if (editor.get(PROVIDER)) editor.models.set(PROVIDER, models) // also declared in opencode.json
			else editor.add({ info, models, sourceConnection: source })
		})

		const log = (e: unknown) => console.error(String(e))
		// the first fetch doesn't hold up startup; the stored list serves meanwhile
		void refresh().catch(log)

		const controller = new AbortController()
		void (async () => {
			const types: ("credential.switched" | "credential.updated" | "integration.updated")[] = [
				"credential.switched",
				"credential.updated",
				"integration.updated",
			]
			for await (const _ of ctx.event.subscribe({ types, signal: controller.signal })) await refresh().catch(log)
		})().catch(() => {})
		const timer = setInterval(() => void refresh().catch(log), REFRESH_MS)

		return () => {
			closed = true
			controller.abort()
			clearInterval(timer)
		}
	},
})
