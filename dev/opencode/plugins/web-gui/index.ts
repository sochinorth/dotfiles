// Desktop GUI plugins in OpenCode Web: serves the web app with plugin GUIs
// loaded, through a local proxy, http://127.0.0.1:49380 (open that instead of
// the server's own address).
//
// The web app already contains the desktop app's GUI plugin host, and GUI
// plugins support running in a browser (ctx.app.platform is "web" there). What
// a plain browser tab lacks is the bridge the desktop app's main process hands
// the window: the source of the plugins' GUI bundles (`platform.plugins`). The
// proxy passes everything through to OpenCode's server except that it
// - serves a bridge script (BRIDGE) and loads it from the app's HTML; it reads
//   the GUI bundles from the server's own /api/plugin/gui, the way the desktop
//   app's main process does, and keeps enable/disable choices in localStorage;
// - hands it to the app: `platform: "web"` in the app's entry script becomes
//   `platform: "web", plugins: <bridge>`;
// - adds 'unsafe-eval' to the page's script-src: the host evaluates a bundle
//   with Function(), as the desktop app's window may and the plain web app's
//   CSP forbids. Only on this proxy's origin.
// GUI bundles' main-process half (`main`, Ipc contracts, native menus) has no
// process to run in here: their IPC reports unavailable, as on any server
// without a desktop app.
//
// Logins carry over: cookies don't depend on the port. If the entry script's
// shape changes in an update, the patch is skipped (logged once) and the app
// runs as plain web.
//
// The upstream is the background service (`opencode service status`), or the
// `upstream` option. Plugins load once per location; one instance gets the
// port, and the others retry it in case that one unloads.
// Options, in opencode.json:
//   "plugins": [{ "package": "./plugins/web-gui", "options": { "port": 49380, "upstream": "http://127.0.0.1:4096" } }]
import { execFile } from "node:child_process"
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http"
import { connect } from "node:net"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"

const RETRY_MS = 30_000
const BRIDGE = "/__web-gui/bridge.js"
const ENTRY = /^\/_assets\/index-[\w-]+\.js$/
const PLATFORM = "platform:{platform:`web`,"

// The bridge, run in the page before the app (a classic script ahead of its
// module). Its shape is what the app's host reads from the desktop app's.
const bridge = () => {
	const listeners = new Set<(e: unknown) => void>()
	const emit = (e: unknown) =>
		listeners.forEach((l) => {
			try {
				l(e)
			} catch (err) {
				console.error("[web-gui]", err)
			}
		})
	const KEY = "web-gui:enabled"
	const enabled = (): { id: string; enabled: boolean }[] => {
		try {
			return JSON.parse(localStorage.getItem(KEY) ?? "[]")
		} catch {
			return []
		}
	}
	const setEnabled = async (id: string, on: boolean) => {
		const list = [...enabled().filter((e) => e.id !== id), { id, enabled: on }]
		localStorage.setItem(KEY, JSON.stringify(list))
		emit({ type: "installed", list })
	}
	const read = async (path: string) => {
		const res = await fetch(path, { credentials: "include" })
		if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`)
		return res.json()
	}
	const guis = async () => {
		const plugins = []
		for (const p of (await read("/api/plugin")).data ?? []) {
			if (!p.id || !p.features?.gui || p.state?.status !== "active") continue
			try {
				const { data } = await read(`/api/plugin/gui?id=${encodeURIComponent(p.id)}`)
				plugins.push({ id: p.id, revision: data.revision, options: data.options ?? {}, code: data.code })
			} catch (e) {
				console.error("[web-gui]", p.id, e)
			}
		}
		return { plugins, reserved: [] }
	}
	// the desktop app pushes changes; here, look every 15 s
	let last = ""
	const refresh = async () => {
		const value = await guis()
		const key = value.plugins.map((p) => `${p.id}@${p.revision}`).join()
		if (key !== last) {
			last = key
			emit({ type: "pluginGuis", ...value })
		}
		return value
	}
	setInterval(() => void refresh().catch(() => {}), 15_000)
	;(globalThis as any).__webGuiBridge = {
		on(listener: (e: unknown) => void) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		pluginGuis: refresh,
		manager: {
			initial: Promise.resolve(enabled()),
			list: async () => enabled(),
			enable: (id: string) => setEnabled(id, true),
			disable: (id: string) => setEnabled(id, false),
			reload: async () => {
				last = ""
				await refresh()
			},
		},
		packaged: false,
		// which servers' plugins to load; here it's always this page's server
		configure() {},
		runMenubarItem() {},
		subscribe: async () => ({ available: false }),
		call: async () => {
			throw new Error("no desktop main process on the web")
		},
	}
}

const run = promisify(execFile)

export default Plugin.define({
	id: "sochinorth.web-gui",
	async setup(ctx) {
		const port = (ctx.options.port as number | undefined) ?? 49380
		let upstream: Promise<URL> | undefined
		const target = () =>
			(upstream ??= (async () => {
				const option = ctx.options.upstream as string | undefined
				if (option) return new URL(option)
				const { stdout } = await run("opencode", ["service", "status"], { timeout: 10_000 })
				const url = stdout.match(/https?:\/\/\S+/)?.[0]
				if (!url) throw new Error(`no service URL in \`opencode service status\`: ${stdout.trim()}`)
				return new URL(url)
			})().catch((e) => {
				upstream = undefined // ask again next time
				throw e
			}))

		let warned = false
		const patchEntry = (code: string) => {
			if (code.includes(PLATFORM)) return code.replace(PLATFORM, `${PLATFORM}plugins:globalThis.__webGuiBridge,`)
			if (!warned) console.error(`web-gui: the app's entry script has no ${PLATFORM}; serving it unpatched`)
			warned = true
			return code
		}
		const patchHtml = (html: string) => html.replace(/<head[^>]*>/i, (head) => `${head}<script src="${BRIDGE}"></script>`)
		const patchCsp = (csp: string) =>
			/script-src[^;]*'unsafe-eval'/.test(csp) ? csp : csp.replace(/script-src/, "script-src 'unsafe-eval'")

		// the request as the server should see it: its own host and origin
		const outgoing = (headers: IncomingHttpHeaders, up: URL, own: string) => {
			const h = { ...headers, host: up.host, "accept-encoding": "identity" }
			if (h.origin) h.origin = up.origin
			if (h.referer) h.referer = h.referer.replace(own, up.origin)
			return h
		}

		const bridgeCode = `(${bridge.toString()})()\n`

		const server: Server = createServer(async (req, res) => {
			const path = (req.url ?? "/").split("?")[0]
			if (path === BRIDGE) {
				res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" }).end(bridgeCode)
				return
			}
			let up: URL
			try {
				up = await target()
			} catch (e) {
				res.writeHead(502, { "content-type": "text/plain" }).end(`web-gui: ${e}\n`)
				return
			}
			const own = `http://${req.headers.host}`
			const headers = outgoing(req.headers, up, own)
			delete headers.connection
			const proxied = request({ host: up.hostname, port: up.port, method: req.method, path: req.url, headers }, (upres) => {
				const h = { ...upres.headers }
				for (const k of ["connection", "keep-alive", "transfer-encoding"]) delete h[k]
				if (typeof h["content-security-policy"] === "string") h["content-security-policy"] = patchCsp(h["content-security-policy"])
				if (typeof h.location === "string") h.location = h.location.replace(up.origin, own)
				const type = String(h["content-type"] ?? "")
				const patch = type.includes("text/html") ? patchHtml : type.includes("javascript") && ENTRY.test(path) ? patchEntry : undefined
				if (!patch) {
					res.writeHead(upres.statusCode ?? 502, h)
					upres.pipe(res)
					return
				}
				const chunks: Buffer[] = []
				upres.on("data", (c: Buffer) => chunks.push(c))
				upres.on("end", () => {
					const body = Buffer.from(patch(Buffer.concat(chunks).toString("utf8")))
					delete h.etag // the patched body isn't the one it names
					res.writeHead(upres.statusCode ?? 200, { ...h, "content-length": body.length }).end(body)
				})
				upres.on("error", () => res.destroy())
			})
			proxied.on("error", (e) => {
				if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" }).end(`web-gui: ${e}\n`)
				else res.destroy()
			})
			req.pipe(proxied)
		})

		// WebSockets: the request head, rewritten the same way, then raw bytes
		server.on("upgrade", async (req, socket, head) => {
			const up = await target().catch(() => undefined)
			if (!up) return socket.destroy()
			const headers = outgoing(req.headers, up, `http://${req.headers.host}`)
			delete (headers as Record<string, unknown>)["accept-encoding"]
			const upstreamSocket = connect(Number(up.port) || 80, up.hostname, () => {
				const lines = [`${req.method} ${req.url} HTTP/1.1`]
				for (const [k, v] of Object.entries(headers)) for (const value of [v].flat()) if (value !== undefined) lines.push(`${k}: ${value}`)
				upstreamSocket.write(lines.join("\r\n") + "\r\n\r\n")
				if (head.length) upstreamSocket.write(head)
				upstreamSocket.pipe(socket)
				socket.pipe(upstreamSocket)
			})
			upstreamSocket.on("error", () => socket.destroy())
			socket.on("error", () => upstreamSocket.destroy())
		})

		let closed = false
		let retry: ReturnType<typeof setTimeout> | undefined
		server.on("error", (e: NodeJS.ErrnoException) => {
			if (e.code !== "EADDRINUSE") console.error("web-gui:", e)
			// another instance (another location) has it; take over if it unloads
			if (!closed) retry = setTimeout(() => server.listen(port, "127.0.0.1"), RETRY_MS)
		})
		server.listen(port, "127.0.0.1")

		return () => {
			closed = true
			clearTimeout(retry)
			server.close()
			server.closeAllConnections?.()
		}
	},
})
