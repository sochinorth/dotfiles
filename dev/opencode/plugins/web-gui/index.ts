// Desktop GUI plugins in OpenCode Web, through a local proxy:
// http://127.0.0.1:49380 (open that instead of the server's own address).
//
// The web app contains the desktop app's GUI plugin host, and GUI plugins run
// in a browser too (ctx.app.platform is "web" there). A plain tab lacks only
// the bridge the desktop app's main process hands its window: the source of
// the GUI bundles (`platform.plugins`). The proxy passes everything through to
// OpenCode's server except that it
// - serves a bridge script (BRIDGE), loaded from the app's HTML, that reads the
//   bundles from the server's /api/plugin/gui as the desktop app's main process
//   does, and keeps enable/disable choices in localStorage;
// - hands it to the app: `platform: "web"` in the entry script gains
//   `plugins: <bridge>`;
// - adds 'unsafe-eval' to the page's script-src, on this proxy's origin only:
//   the host evaluates a bundle with Function(), which the web app's CSP forbids.
// Bundles' main-process half (`main`, IPC, native menus) has nowhere to run
// here and reports unavailable, as on any server without a desktop app.
//
// Logins carry over: cookies don't depend on the port. If an update changes the
// entry script's shape, the patch is skipped (logged once) and Web runs plain.
//
// The proxy answers only to its loopback names (127.0.0.1, localhost, [::1] on
// its port), so a page on another name resolved to 127.0.0.1 (DNS rebinding)
// gets a 403. It gives the server's origin only to its own pages' requests:
// any other Origin passes through as is, so the server's cross-origin checks
// (CORS, the session cookie's origin check) hold as if it were asked directly.
//
// The upstream is the background service (`opencode service status`), or the
// `upstream` option, a plain-HTTP URL. Plugins load once per location; one
// instance gets the port, and the others retry it in case that one unloads.
// Options, in opencode.json:
//   "plugins": [{ "package": "./plugins/web-gui", "options": { "port": 49380, "upstream": "http://127.0.0.1:4096" } }]
import { execFile } from "node:child_process"
import { createServer, request, type IncomingHttpHeaders } from "node:http"
import { connect } from "node:net"
import type { Duplex } from "node:stream"
import { buffer } from "node:stream/consumers"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"

// hop-by-hop headers (plus any the Connection header lists): not forwarded
const HOP = ["connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]
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
	// a password login's Authorization (see configure); a cookie login needs none
	let auth: string | undefined
	const read = async (path: string) => {
		const res = await fetch(path, { credentials: "include", headers: auth ? { authorization: auth } : {} })
		if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`)
		return res.json()
	}
	// the desktop app pushes changes; here, look every 15 s while the tab shows
	let last = ""
	const refresh = async () => {
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
		const key = plugins.map((p) => `${p.id}@${p.revision}`).join()
		if (key !== last) {
			last = key
			emit({ type: "pluginGuis", plugins, reserved: [] })
		}
		return { plugins, reserved: [] }
	}
	setInterval(() => {
		if (!document.hidden) void refresh().catch(() => {})
	}, 15_000)
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
		// the app's servers; plugins come from this page's one, which carries a
		// password if the app logged in with one (sent as the app does)
		configure(servers: { url: string; password?: string }[]) {
			const password = servers.find((s) => s.url.replace(/\/$/, "") === location.origin)?.password
			const next = password === undefined ? undefined : `Basic ${btoa(`opencode:${password}`)}`
			if (next === auth) return
			auth = next
			void refresh().catch(() => {})
		},
		runMenubarItem() {},
		subscribe: async () => ({ available: false }),
		call: async () => {
			throw new Error("no desktop main process on the web")
		},
	}
}

export default Plugin.define({
	id: "sochinorth.web-gui",
	async setup(ctx) {
		const port = (ctx.options.port as number | undefined) ?? 49380
		let upstream: Promise<URL> | undefined
		const target = () =>
			(upstream ??= (async () => {
				let url = ctx.options.upstream as string | undefined
				if (!url) {
					const { stdout } = await promisify(execFile)("opencode", ["service", "status"], { timeout: 10_000 })
					url = stdout.match(/https?:\/\/\S+/)?.[0]
					if (!url) throw new Error(`no service URL in \`opencode service status\`: ${stdout.trim()}`)
				}
				const parsed = new URL(url)
				if (parsed.protocol !== "http:") throw new Error(`the upstream must be plain HTTP: ${url}`)
				return parsed
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

		// the origins of this proxy's pages; any other Host gets a 403
		const origins = new Set(["127.0.0.1", "localhost", "[::1]"].map((name) => `http://${name}:${port}`))
		// the request as the server should see it: its own host, and its own
		// origin where it comes from this proxy's pages (other origins stay)
		const outgoing = (headers: IncomingHttpHeaders, up: URL, own: string) => {
			const h = { ...headers, host: up.host }
			if (h.origin === own) h.origin = up.origin
			if (h.referer?.startsWith(`${own}/`)) h.referer = up.origin + h.referer.slice(own.length)
			return h
		}
		const stripHop = (headers: IncomingHttpHeaders) => {
			for (const k of [...HOP, ...(headers.connection ?? "").split(",").map((k) => k.trim().toLowerCase())]) delete headers[k]
			return headers
		}

		const server = createServer(async (req, res) => {
			const fail = (status: number, message: unknown) => res.writeHead(status, { "content-type": "text/plain" }).end(`web-gui: ${message}\n`)
			const own = `http://${req.headers.host?.toLowerCase()}`
			if (!origins.has(own)) return fail(403, "unknown Host")
			const path = req.url!.split("?")[0]
			if (path === BRIDGE) return res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" }).end(`(${bridge})()\n`)
			const up = await target().catch((e) => void fail(502, e))
			if (!up) return
			const headers = stripHop({ ...outgoing(req.headers, up, own), "accept-encoding": "identity" })
			// the URL gives the address (IPv6 brackets stripped); path stays as sent
			const proxied = request(up, { method: req.method, path: req.url, headers }, (upres) => {
				const h = stripHop({ ...upres.headers })
				if (typeof h["content-security-policy"] === "string") h["content-security-policy"] = patchCsp(h["content-security-policy"])
				if (h.location?.startsWith(up.origin)) h.location = own + h.location.slice(up.origin.length)
				const type = h["content-type"] ?? ""
				// only whole bodies: not HEAD's, a 304's, or an encoded one
				const whole = req.method !== "HEAD" && upres.statusCode === 200 && (h["content-encoding"] ?? "identity") === "identity"
				const patch = !whole ? undefined : type.includes("text/html") ? patchHtml : type.includes("javascript") && ENTRY.test(path) ? patchEntry : undefined
				if (!patch) return upres.pipe(res.writeHead(upres.statusCode!, h))
				delete h.etag // the patched body isn't the one it names
				buffer(upres).then((raw) => {
					const body = patch(raw.toString())
					res.writeHead(200, { ...h, "content-length": Buffer.byteLength(body) }).end(body)
				}, () => res.destroy())
			})
			proxied.on("error", (e) => (res.headersSent ? res.destroy() : fail(502, e)))
			// a client gone mid-response (a closed event stream) ends the upstream request
			res.on("close", () => {
				if (!res.writableFinished) proxied.destroy()
			})
			req.pipe(proxied)
		})

		// WebSockets: the request head, rewritten the same way, then raw bytes.
		// Upgraded sockets leave the server's connection tracking: unload closes them.
		const tunnels = new Set<Duplex>()
		server.on("upgrade", async (req, socket, head) => {
			socket.on("error", () => socket.destroy())
			const own = `http://${req.headers.host?.toLowerCase()}`
			if (!origins.has(own)) return socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n")
			tunnels.add(socket)
			socket.on("close", () => tunnels.delete(socket))
			const up = await target().catch(() => undefined)
			if (!up || socket.destroyed) return socket.destroy()
			const lines = Object.entries(outgoing(req.headers, up, own)).flatMap(([k, v]) => [v].flat().map((v) => `${k}: ${v}\r\n`))
			// URL keeps an IPv6 host's brackets; a socket takes the bare address
			const conn = connect(Number(up.port) || 80, up.hostname.replace(/^\[(.*)\]$/, "$1"), () => {
				conn.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("")}\r\n`)
				conn.write(head)
				socket.pipe(conn).pipe(socket)
			})
			conn.on("error", () => socket.destroy())
			conn.on("close", () => socket.destroy())
			socket.on("close", () => conn.destroy())
		})

		let closed = false
		server.on("error", (e: NodeJS.ErrnoException) => {
			if (e.code !== "EADDRINUSE") return console.error("web-gui:", e)
			// another instance (another location) has it; take over if it unloads
			setTimeout(() => {
				if (!closed) server.listen(port, "127.0.0.1")
			}, 30_000)
		})
		server.listen(port, "127.0.0.1")

		return () => {
			closed = true
			server.close()
			server.closeAllConnections()
			for (const socket of tunnels) socket.destroy()
		}
	},
})
