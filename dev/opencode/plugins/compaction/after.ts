// What follows a checkpoint in every later request: the readable index (native),
// a note on the transcript, facts from the compacted stretch, and Claude Code's
// restore of the five files read or changed most recently.
import { readFileSync, realpathSync, statSync } from "node:fs"
import { basename, isAbsolute, resolve, sep } from "node:path"
import * as Prompt from "./prompt"
import { brief, type Leaf } from "./transcript"

// Claude Code's post-compaction file restore
const RESTORE_FILES = 5
const FILE_TOKENS = 5_000
const RESTORE_TOKENS = 50_000
// per list in the facts block
const FACTS = 40
// loaded on their own, in the system prompt
const INSTRUCTION_FILES = new Set(["AGENTS.md", "CLAUDE.md"])

const tokens = (text: string) => Math.ceil(text.length / 4)
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text)

/** What follows a checkpoint: its text, and the files restored in it (the next compaction's earliest candidates). */
export type After = { files: string[]; text: string }

// Paths a completed tool call read or wrote.
function paths(part: any): { path: string; write: boolean }[] {
	if (part.state?.status !== "completed") return []
	const input = part.state.input ?? {}
	switch (part.name) {
		case "read":
		case "edit":
		case "write": {
			const path = input.path ?? input.filePath
			return typeof path === "string" ? [{ path, write: part.name !== "read" }] : []
		}
		case "patch":
			return typeof input.patchText === "string"
				? [...input.patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((m) => ({ path: m[1].trim(), write: true }))
				: []
	}
	return []
}

// One pass over the compacted stretch's tool calls: files touched, in order, and failures.
function survey(directory: string, history: readonly any[]) {
	const touched: { path: string; write: boolean }[] = []
	const failed: string[] = []
	for (const m of history)
		for (const p of m.type === "assistant" ? (m.content ?? []) : []) {
			if (p?.type !== "tool") continue
			for (const x of paths(p)) touched.push({ path: resolve(directory, x.path), write: x.write })
			if (p.state?.status === "error") failed.push(`${p.name} ${brief(p.state.input)}: ${clip(String(p.state.error?.message ?? "").split("\n")[0], 200)}`)
		}
	return { touched, failed }
}

// Claude Code's restore: most recent first, files that exist, read whole if
// they fit, named otherwise. Only text files inside the session's directory are
// candidates (through symlinks too, read through the path checked): one read
// elsewhere, with the permission that took, isn't pulled back into every
// request by the harness. The facts list it among the files read.
function restore(directory: string, order: string[]): After {
	let root: string
	try {
		root = realpathSync(directory)
	} catch {
		return { files: [], text: "" }
	}
	// the content, null when too large to restore, undefined when not a candidate
	const contentOf = (path: string): string | null | undefined => {
		try {
			const real = realpathSync(path)
			const stat = statSync(real)
			if ((real !== root && !real.startsWith(root + sep)) || !stat.isFile()) return
			if (stat.size > FILE_TOKENS * 8) return null
			const content = readFileSync(real, "utf8")
			if (content.slice(0, 8192).includes("\0")) return
			return tokens(content) > FILE_TOKENS ? null : content
		} catch {}
	}
	const picked = new Map<string, string | null>()
	for (const path of [...order].reverse()) {
		if (picked.size === RESTORE_FILES) break
		if (picked.has(path) || !isAbsolute(path) || INSTRUCTION_FILES.has(basename(path))) continue
		const content = contentOf(path)
		if (content !== undefined) picked.set(path, content)
	}
	const blocks: string[] = []
	let budget = RESTORE_TOKENS
	for (const [path, content] of picked) {
		const block =
			content === null
				? `Note: ${path} was read before the conversation was compacted, but it is too large to include here. Read it again if you need it.`
				: `<file path="${path}">\n${content.replace(/\n$/, "").split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n")}\n</file>`
		if (tokens(block) > budget) continue
		budget -= tokens(block)
		blocks.push(block)
	}
	const text = blocks.length ? [Prompt.RESTORED, ...blocks].join("\n\n") : ""
	return { files: [...picked.keys()], text }
}

/**
 * What follows a checkpoint over `history`, the compacted stretch, with its
 * large outputs; `earlier`, the files the last checkpoint restored. An empty
 * restore is recorded too: the compaction after it starts from no files.
 */
export function after(directory: string, dir: string, history: readonly any[], outputs: readonly Leaf[], earlier: string[], index?: string): After {
	const { touched, failed } = survey(directory, history)
	const changed = new Set(touched.filter((x) => x.write).map((x) => x.path))
	const read = new Set(touched.filter((x) => !x.write && !changed.has(x.path)).map((x) => x.path))
	const list = (title: string, items: string[]) =>
		items.length ? [`${title}:`, ...(items.length > FACTS ? [...items.slice(-FACTS), `(${items.length - FACTS} earlier not listed)`] : items).map((i) => `- ${i}`)] : []
	const large = outputs.map((o) => `${o.anchor} ${o.tool} ${JSON.stringify(clip(o.input, 120))} ${Math.max(1, Math.round(o.bytes / 1024))} KB`)
	const facts = [
		...list("Files changed", [...changed]),
		...list("Files read", [...read]),
		...list("Large outputs, in full in the transcript", large),
		...list("Failed tool calls", failed),
	]
	const files = restore(directory, [...earlier, ...touched.map((x) => x.path)])
	const text = [index && Prompt.readable(index), Prompt.note(dir), facts.length && [Prompt.FACTS, ...facts].join("\n"), files.text]
	return { files: files.files, text: text.filter(Boolean).join("\n\n") }
}
