// OpenAI's models, when it's signed in through ChatGPT, as the Codex backend
// lists them rather than as OpenCode's built-in rules pick them.
//
// OpenCode's ChatGPT sign-in keeps chat models named gpt-N.M from 5.6 on and a
// fixed image list (gpt-image-2), and takes limits from the API catalog. The
// backend's own index (GET /backend-api/codex/models, what Codex reads) says
// otherwise, and the backend agrees with the index: it serves models the rules
// hide (gpt-reserve, codex-auto-review) and rejects some they offer
// (gpt-5.6-cyber), and it caps context below the catalog's 1.05M (it has
// been reported refusing input just above its max_context_window).
//
// With an index for the active connection, OpenAI chat models are:
//   offered   iff the index lists the slug, the service tier a model sends
//             (the -fast/-ultrafast entries) is one the index lists for it, and
//             it sends no reasoning mode (the -pro entries: the index lists no
//             modes); listed slugs the catalog lacks are added
//   limited   to the index's max_context_window (its context_window is Codex's
//             default, which Codex's config can raise up to the max)
//   varied    by the index's reasoning levels, less ones the API rejects (it
//             lists "ultra", which /responses refuses)
// Prices are dropped: subscription use. Without an index yet, OpenCode's
// choices stand. The index lists no image models; the Images API serves the
// catalog's gpt-image models from version 2 on, so those are offered.
//
// The index is refetched when the credential changes and every 6 hours, and
// stored with the connection it came from, so it serves startup and offline,
// and is ignored while another connection is active.
//
// OpenCode finds it in ~/.config/opencode/plugins/ on its own. Edits need
// `opencode service restart`: the service caches the module by path.
import { Model, Plugin } from "@opencode/plugin"

const PROVIDER = "openai"
const CHATGPT = "https://chatgpt.com/backend-api/codex"
// The index leaves out models whose minimal_client_version is above this.
const CLIENT_VERSION = "99.0.0"
// reasoning.effort values /responses accepts
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
const IMAGE = /^gpt-image-(\d+)(?:\.\d+)?(?:-|$)/

type Entry = { slug: string; name: string; context?: number; efforts: string[]; tiers: string[]; input: string[] }

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

// API or stored data: keep the first entry per nonempty slug, in order.
const parse = (data: unknown): Entry[] | undefined => {
	if (!Array.isArray(data)) return
	const bySlug = new Map<string, Entry>()
	for (const m of data) {
		const slug = m?.slug
		if (typeof slug !== "string" || !slug || bySlug.has(slug)) continue
		// The model's window is max_context_window: Codex's context_window is its
		// default, which config (model_context_window) raises up to the max.
		const context = [m.context, m.max_context_window, m.context_window].find((n) => Number.isSafeInteger(n) && n > 0)
		bySlug.set(slug, {
			slug,
			name: typeof m.name === "string" ? m.name : typeof m.display_name === "string" ? m.display_name : slug,
			...(context ? { context } : {}),
			efforts: Array.isArray(m.efforts) ? strings(m.efforts) : strings(m.supported_reasoning_levels?.map((l: any) => l?.effort)),
			tiers: Array.isArray(m.tiers) ? strings(m.tiers) : strings(m.service_tiers?.map((t: any) => t?.id)),
			input: Array.isArray(m.input) ? strings(m.input) : strings(m.input_modalities),
		})
	}
	return [...bySlug.values()]
}

// OpenCode's connection identity; metadata changes don't change the key.
const key = (c: any) => {
	const id = c?.type === "credential" ? c.id : c?.type === "env" ? c.name : undefined
	return typeof id === "string" ? `${c.type}:${id}` : undefined
}

// The ChatGPT account the access token is for, as the backend wants it sent.
const account = (access: string) => {
	try {
		const claims = JSON.parse(atob((access.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/")))
		const id = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id
		return typeof id === "string" ? id : undefined
	} catch {
		return undefined
	}
}

// Same settings as OpenCode's own OpenAI variants.
const variant = (effort: string) => ({
	id: effort as Model.VariantID,
	settings: { reasoningEffort: effort, reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
})

export default Plugin.define({
	id: "sochinorth.chatgpt-models",
	async setup(ctx) {
		let closed = false
		const log = (e: unknown) => closed || console.error(`chatgpt-models: ${e instanceof Error ? e.message : String(e)}`)

		type Connection = Awaited<ReturnType<typeof ctx.integration.connection.active>>
		const stored = (await ctx.storage.get("models")) as { models?: unknown; source?: Connection } | undefined
		let source = key(stored?.source) ? stored?.source : undefined
		let index = (source && parse(stored?.models)) || []
		let active = key(await ctx.integration.connection.active(PROVIDER).catch(() => undefined))
		// the index, if it's the active connection's
		const current = () => (index.length > 0 && active !== undefined && active === key(source) ? new Map(index.map((e) => [e.slug, e])) : undefined)
		// slugs this plugin added to the provider, to switch off again off ChatGPT
		const added = new Set<string>()

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
					if (key(connection) !== active) {
						active = key(connection)
						await ctx.provider.reload() // drop or restore the index at once
					}
					if (!connection) continue
					const credential = await ctx.integration.connection.resolve(connection)
					if (credential?.type !== "oauth") continue // an API key: OpenCode's rules don't apply
					const id = account(credential.access)
					const res = await fetch(`${CHATGPT}/models?client_version=${CLIENT_VERSION}`, {
						headers: {
							authorization: `Bearer ${credential.access}`,
							...(id ? { "chatgpt-account-id": id } : {}),
							originator: "opencode",
							"user-agent": "opencode",
						},
						signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
					})
					// An expired token is refreshed on the next request, which updates the
					// credential and so queues a rerun.
					if (!res.ok) throw new Error(`GET /models: HTTP ${res.status}`)
					const fresh = parse(((await res.json()) as { models?: unknown } | null)?.models)
					if (!fresh?.length) throw new Error("GET /models: no models") // Not an empty inventory.
					// A switch queues a rerun; don't publish the old connection's result.
					if (closed || key(await ctx.integration.connection.active(PROVIDER)) !== key(connection)) continue
					if (JSON.stringify(fresh) === JSON.stringify(index) && key(source) === key(connection)) continue
					// Persist before committing in memory, so failed writes remain retryable.
					await ctx.storage.set("models", { models: fresh, source: connection })
					index = fresh
					source = connection
					if (!closed) await ctx.provider.reload()
				} catch (e) {
					log(e)
				}
			}
			running = false
		}

		// Listed slugs the catalog lacks. Added whatever the sign-in: the model
		// transform below only switches them on through ChatGPT.
		await ctx.provider.transform((editor) => {
			added.clear()
			const record = editor.get(PROVIDER)
			const listed = current()
			if (!record || !listed) return
			const providerID = record.provider.id
			const models: Model.Info[] = []
			for (const e of listed.values()) {
				if (record.models.has(e.slug)) continue
				added.add(e.slug)
				const base = Model.Info.default(providerID, Model.ID.make(e.slug))
				models.push({
					...base,
					type: "chat",
					name: e.name,
					capabilities: { tools: true, input: e.input.length ? e.input : ["text"], output: ["text"], temperature: false },
					variants: e.efforts.filter((x) => EFFORTS.has(x)).map(variant),
					...(e.context ? { limit: { context: e.context, output: Math.min(base.limit.output, e.context) } } : {}),
				})
			}
			if (models.length) editor.models.set(PROVIDER, [...record.models.values(), ...models])
		})

		// After OpenCode's own ChatGPT rules, which run first and switch models off.
		await ctx.model.transform((editor) => {
			const provider = editor.provider.get(PROVIDER)?.provider
			const listed = current()
			for (const model of editor.list(PROVIDER)) {
				const slug = model.modelID ?? model.id
				if ((model.settings?.baseURL ?? provider?.settings?.baseURL) !== CHATGPT) {
					if (added.has(slug)) editor.update(model.providerID, model.id, (m) => void (m.enabled = false))
					continue
				}
				if (model.type === "image") {
					const m = slug.match(IMAGE)
					if (m && Number(m[1]) >= 2)
						editor.update(model.providerID, model.id, (x) => {
							x.enabled = true
							x.cost = []
						})
					continue
				}
				if ((model.type ?? "chat") !== "chat" || !listed) continue
				const entry = listed.get(slug)
				const tier = model.body?.service_tier
				// The index lists no reasoning modes, and /responses refuses "pro".
				const offered = entry !== undefined && (typeof tier !== "string" || entry.tiers.includes(tier)) && model.body?.reasoning?.mode === undefined
				editor.update(model.providerID, model.id, (m) => {
					m.enabled = offered
					if (!entry || !offered) return
					m.cost = []
					if (entry.context) m.limit = { context: entry.context, output: Math.min(m.limit.output, entry.context) }
					const have = new Map(m.variants.map((v) => [v.id as string, v]))
					m.variants = entry.efforts.filter((x) => EFFORTS.has(x)).map((x) => have.get(x) ?? variant(x))
				})
			}
		})

		void refresh() // The stored index serves startup while this runs.
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
