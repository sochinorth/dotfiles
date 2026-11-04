// OpenCode websearch providers backed by the vendors' own search, each a small
// model summarizing with markdown citations: openai (web_search, on a ChatGPT
// login through the Codex backend, or an API key) and anthropic (`claude -p`
// allowed only WebSearch, inheriting the server's environment, claude-entrypoint's
// included). As their own clients do, the summary comes once, each paragraph under
// the first source it cites; anthropic adds Claude's other result links (Claude
// Code), openai only cited ones (Codex).
// A third, native, picks by the model searching: Claude Agent's use anthropic,
// OpenAI's openai, others the fallback. Selecting it is config's job
// (websearch.provider), which a Console workspace's own choice would otherwise override.
// Options: fallback (a provider ID, "openai"), openai { model: "gpt-6-luna",
// effort: "low" }, anthropic { model: "haiku" }
import { spawn } from "node:child_process"
import { once } from "node:events"
import { homedir } from "node:os"
import { Plugin } from "@opencode/plugin"

// As the providers send them, unchecked: results() keeps only http(s) URLs and string titles.
type Link = { url: unknown; title?: unknown }
type Result = { url: string; title?: string; content?: string; time: {} }

const TIMEOUT = 120_000
const MAX_BYTES = 16 << 20
// Model provider -> search provider for native; others get the fallback.
const PIN: Record<string, string> = { "claude-agent": "anthropic", openai: "openai" }
// OpenCode's ChatGPT login methods for the openai integration.
const CHATGPT = new Set(["chatgpt-browser", "chatgpt-headless", "chatgpt-token-sharing"])
const INSTRUCTIONS =
	"Search the web for the user's query. Reply with a concise, factual summary of what the sources say, " +
	"citing every claim with a markdown link to its source. Don't ask questions or offer follow-ups."
// URLs may hold balanced parentheses, e.g. Wikipedia's ".../Bun_(software)".
const LINK = /\[([^\]]*)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g

// OpenAI tags its citation URLs; the same page should be one result.
const normalize = (url: string) => {
	try {
		const u = new URL(url)
		u.searchParams.delete("utm_source")
		return u.href
	} catch {
		return url
	}
}

// The summary's cited links in order, holding its paragraphs (or list items), then `links`' others.
const results = (summary: string, links: Link[]): Result[] => {
	const byURL = new Map<string, Result>()
	const add = (url: unknown, title?: unknown) => {
		if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return
		const key = normalize(url)
		const r = byURL.get(key) ?? { url: key, time: {} }
		byURL.set(key, r)
		if (typeof title === "string" && title && !r.title) r.title = title.replace(/^#\s*/, "")
		return r
	}
	for (const block of summary.split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/).map((b) => b.trim())) {
		// Each paragraph once, under its first source; its other links stay inline.
		let owner: Result | undefined
		for (const [, title, url] of block.matchAll(LINK)) {
			const r = add(url, title)
			if (!r || owner) continue
			owner = r
			r.content = r.content ? `${r.content}\n\n${block}` : block
		}
	}
	for (const { url, title } of links) add(url, title)
	return [...byURL.values()]
}

// A stream's bytes as text, decoded once, as a chunk can split a character. Streams
// sharing a budget refuse more than MAX_BYTES between them.
const read = async (stream: AsyncIterable<Uint8Array> | null, budget = { size: 0 }) => {
	const chunks: Uint8Array[] = []
	for await (const chunk of stream ?? []) {
		if ((budget.size += chunk.byteLength) > MAX_BYTES) throw new Error(`output over ${MAX_BYTES} bytes`)
		chunks.push(chunk)
	}
	return Buffer.concat(chunks).toString()
}

export default Plugin.define({
	id: "sochinorth.native-search",
	async setup(ctx) {
		const opts = ctx.options as Record<string, any>
		const option = <T>(name: string, value: unknown, valid: (v: any) => boolean, fallback: T): T => {
			if (value === undefined || valid(value)) return (value as T) ?? fallback
			console.error(`native-search: options.${name}: invalid; using ${JSON.stringify(fallback)}`)
			return fallback
		}
		const text = (v: unknown) => typeof v === "string" && v !== ""
		const openaiModel = option("openai.model", opts.openai?.model, text, "gpt-6-luna")
		const openaiEffort = option("openai.effort", opts.openai?.effort, text, "low")
		const anthropicModel = option("anthropic.model", opts.anthropic?.model, text, "haiku")
		const fallback = option("fallback", opts.fallback, (v) => text(v) && v !== "native", "openai")
		// Unloading aborts searches in flight, killing their claude.
		const lifetime = new AbortController()

		const openai = async (query: string, signal: AbortSignal) => {
			const connection = await ctx.integration.connection.active("openai")
			const credential = connection && (await ctx.integration.connection.resolve(connection))
			let url = "https://api.openai.com/v1/responses"
			let headers: Record<string, string>
			if (credential?.type === "oauth" && CHATGPT.has(credential.methodID)) {
				const account = credential.metadata?.accountID
				url = "https://chatgpt.com/backend-api/codex/responses"
				headers = { authorization: `Bearer ${credential.access}`, originator: "codex_cli_rs", "openai-beta": "responses=experimental" }
				if (typeof account === "string") headers["chatgpt-account-id"] = account
			} else if (credential?.type === "key") headers = { authorization: `Bearer ${credential.key}` }
			else throw new Error("no usable OpenAI connection: connect a ChatGPT login or an API key with /connect")
			const res = await fetch(url, {
				method: "POST",
				headers: { ...headers, "content-type": "application/json", accept: "text/event-stream" },
				body: JSON.stringify({
					model: openaiModel,
					instructions: INSTRUCTIONS,
					input: [{ type: "message", role: "user", content: [{ type: "input_text", text: query }] }],
					tools: [{ type: "web_search" }],
					tool_choice: "required",
					reasoning: { effort: openaiEffort },
					store: false,
					stream: true, // the Codex backend only streams
				}),
				signal,
			})
			const body = await read(res.body as AsyncIterable<Uint8Array> | null)
			if (!res.ok) throw new Error(`OpenAI: HTTP ${res.status} ${body.slice(0, 300)}`)
			let summary = ""
			let completed = false
			const links: Link[] = []
			const list = (v: unknown): any[] => (Array.isArray(v) ? v : [])
			for (const line of body.split("\n")) {
				if (!line.startsWith("data: ")) continue
				const { type, item, error, response } = JSON.parse(line.slice(6)) ?? {}
				if (type === "error" || type === "response.failed" || type === "response.incomplete") {
					const reason = error?.message ?? response?.error?.message ?? response?.incomplete_details?.reason
					throw new Error(`OpenAI: ${type}${reason ? `: ${reason}` : ""}`)
				}
				completed ||= type === "response.completed"
				if (type !== "response.output_item.done") continue
				for (const part of item?.type === "message" ? list(item.content) : []) {
					if (part?.type !== "output_text" || typeof part.text !== "string") continue
					// Citations mark spans; one missing its markdown link gets it, for results() to find.
					let text: string = part.text
					const spans = list(part.annotations).filter(
						(a) =>
							a?.type === "url_citation" && typeof a.url === "string" && Number.isInteger(a.start_index) &&
							Number.isInteger(a.end_index) && 0 <= a.start_index && a.start_index <= a.end_index && a.end_index <= text.length,
					)
					for (const a of spans.sort((a, b) => b.end_index - a.end_index)) {
						links.push({ url: a.url, title: a.title })
						if (!text.slice(a.start_index, a.end_index).includes(a.url))
							text = `${text.slice(0, a.end_index)} [${typeof a.title === "string" ? a.title : "source"}](${a.url})${text.slice(a.end_index)}`
					}
					summary += (summary ? "\n\n" : "") + text
				}
			}
			if (!completed) throw new Error("OpenAI: the response stream ended before completing")
			return results(summary, links)
		}

		const anthropic = async (query: string, signal: AbortSignal) => {
			const child = spawn(
				"claude",
				["-p", "--model", anthropicModel, "--tools", "WebSearch", "--allowedTools", "WebSearch",
					"--append-system-prompt", INSTRUCTIONS, "--setting-sources", "", "--strict-mcp-config",
					"--no-session-persistence", "--output-format", "stream-json", "--verbose"],
				{ cwd: homedir(), signal },
			)
			// The prompt goes on stdin, not argv, where a query starting with "-" would read as a flag.
			child.stdin.on("error", () => {}) // An early exit closes stdin; the exit status says why.
			child.stdin.end(query)
			try {
				const budget = { size: 0 }
				const [out, err, [code, killer]] = await Promise.all([read(child.stdout, budget), read(child.stderr, budget), once(child, "close")])
				const links: Link[] = []
				let summary: string | undefined
				let failure: string | undefined
				for (const line of out.split("\n")) {
					let event: any
					try {
						event = JSON.parse(line)
					} catch {
						continue
					}
					const found = event?.tool_use_result?.results
					for (const r of Array.isArray(found) ? found : [])
						if (Array.isArray(r?.content)) for (const l of r.content) links.push({ url: l?.url, title: l?.title })
					if (event?.type === "result" && event.is_error) failure = String(event.result ?? event.subtype)
					else if (event?.type === "result") summary = String(event.result ?? "")
				}
				if (code === 0 && summary !== undefined) return results(summary, links)
				throw new Error(`claude: ${failure ?? (err.trim().slice(-300) || `exited with ${killer ?? code}`)}`)
			} finally {
				child.kill("SIGKILL") // a no-op once it has exited
			}
		}

		// A provider learns only the query, so native matches it to the websearch call
		// about to run, whose session's agent loop last used `models`' provider.
		const models = new Map<string, string>()
		const pending: { id: string; query: unknown; search?: string }[] = []
		await ctx.session.hook("context", ({ sessionID, model }) => {
			models.delete(sessionID) // re-inserted last, so the oldest go first
			models.set(sessionID, model.providerID)
			if (models.size > 1000) models.delete(models.keys().next().value!)
		})
		await ctx.tool.hook("execute.before", ({ tool, id, sessionID, input }) => {
			if (tool !== "websearch") return
			pending.push({ id, query: (input as any)?.query, search: PIN[models.get(sessionID) ?? ""] })
			// Bounded even if execute.after never comes; not by age, as a call can wait long on permission.
			if (pending.length > 100) pending.shift()
		})
		// Drops calls that never reached a provider, e.g. denied ones.
		await ctx.tool.hook("execute.after", ({ id }) => {
			const i = pending.findIndex((p) => p.id === id)
			if (i >= 0) pending.splice(i, 1)
		})
		const native = async (query: string, signal: AbortSignal) => {
			const i = pending.findIndex((p) => p.query === query)
			const search = (i >= 0 && pending.splice(i, 1)[0].search) || fallback
			if (search === "openai") return openai(query, signal)
			if (search === "anthropic") return anthropic(query, signal)
			return (await ctx.websearch.query({ query, providerID: search }, { signal })).data.results
		}

		await ctx.websearch.transform((editor) => {
			for (const [id, name, search] of [
				["native", "Native (Claude Agent: anthropic, OpenAI: openai)", native],
				["openai", "OpenAI (native)", openai],
				["anthropic", "Anthropic (native, via Claude Code)", anthropic],
			] as const)
				editor.add({
					id,
					name,
					execute: ({ query }, { signal }) => search(query, AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(TIMEOUT)])),
				})
		})
		return () => lifetime.abort()
	},
})
