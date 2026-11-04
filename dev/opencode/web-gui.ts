// Desktop GUI plugins in OpenCode Web, through a local proxy in front of the
// background service: http://127.0.0.1:44444 (or localhost:44444). The
// dev.mise.web-gui user unit runs it (mise.dev.toml), so it's up from boot.
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
// If an update changes the entry script's shape, the patch is skipped (logged
// once) and Web runs plain.
//
// Logins carry over from the service's own address: cookies don't depend on
// the port. The proxy answers only to its loopback names (127.0.0.1,
// localhost, [::1] on its port), so a page on another name resolved to
// 127.0.0.1 (DNS rebinding) gets a 403. It gives the server's origin only to
// its own pages' requests: any other Origin passes through as is, so the
// server's cross-origin checks (CORS, the session cookie's origin check) hold
// as if it were asked directly.
//
// It finds the service in its service.json, as the CLI does. When the service
// isn't running, the proxy starts it through the dev.mise.opencode unit, so it
// runs under systemd rather than under this unit or a terminal.
// Environment: WEB_GUI_PORT (44444).
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createServer, request, type IncomingHttpHeaders } from "node:http"
import { connect } from "node:net"
import { homedir } from "node:os"
import { buffer } from "node:stream/consumers"
import { promisify } from "node:util"

const PORT = Number(process.env.WEB_GUI_PORT ?? 44444)
const SERVICE = `${process.env.XDG_STATE_HOME || `${homedir()}/.local/state`}/opencode/service.json`
const UNIT = "dev.mise.opencode.service"
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

type Service = { url: URL; pid: number }

const run = promisify(execFile)
const readService = async (): Promise<Service | undefined> => {
	let raw: string
	try {
		raw = await readFile(SERVICE, "utf8")
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined
		throw e
	}
	const s = JSON.parse(raw) as { url: string; pid: number }
	const url = new URL(s.url)
	if (url.protocol !== "http:") throw new Error(`the service isn't plain HTTP: ${s.url}`)
	return { url, pid: s.pid }
}
const alive = (pid: number) => {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM"
	}
}
// one start at a time; `opencode service start` (the unit's ExecStart) returns
// once the server answers, and does nothing when one already runs
let starting: Promise<void> | undefined
const startService = () =>
	(starting ??= run("systemctl", ["--user", "start", UNIT], { timeout: 90_000 })
		.then(() => {}, (e) => {
			throw new Error(`couldn't start ${UNIT} (journalctl --user -u ${UNIT}): ${e.stderr?.trim() || e.message}`)
		})
		.finally(() => (starting = undefined)))
// the running service, started first if it isn't
const service = async () => {
	const s = await readService()
	if (s && alive(s.pid)) return s
	await startService()
	const started = await readService()
	if (!started) throw new Error(`${UNIT} started, but there's no ${SERVICE}`)
	return started
}

let warned = false
const patchEntry = (code: string) => {
	if (code.includes(PLATFORM)) return code.replace(PLATFORM, `${PLATFORM}plugins:globalThis.__webGuiBridge,`)
	if (!warned) console.error(`the app's entry script has no ${PLATFORM}; serving it unpatched`)
	warned = true
	return code
}
const patchHtml = (html: string) => html.replace(/<head[^>]*>/i, (head) => `${head}<script src="${BRIDGE}"></script>`)
const patchCsp = (csp: string) =>
	/script-src[^;]*'unsafe-eval'/.test(csp) ? csp : csp.replace(/script-src/, "script-src 'unsafe-eval'")

// the origins of this proxy's pages; any other Host gets a 403
const origins = new Set(["127.0.0.1", "localhost", "[::1]"].map((name) => `http://${name}:${PORT}`))
// the request as the server should see it: its own host, and its own origin
// where it comes from this proxy's pages (other origins stay)
const outgoing = (headers: IncomingHttpHeaders, s: Service, own: string) => {
	const h: IncomingHttpHeaders = { ...headers, host: s.url.host }
	if (h.origin === own) h.origin = s.url.origin
	if (h.referer?.startsWith(`${own}/`)) h.referer = s.url.origin + h.referer.slice(own.length)
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
	// a refused connection (a stale service.json) starts the service, and a
	// bodiless request is sent again
	const send = async (retry: boolean) => {
		const s = await service().catch((e) => void fail(502, e instanceof Error ? e.message : e))
		if (!s) return
		const headers = stripHop({ ...outgoing(req.headers, s, own), "accept-encoding": "identity" })
		// the URL gives the address (IPv6 brackets stripped); path stays as sent
		const proxied = request(s.url, { method: req.method, path: req.url, headers }, (upres) => {
			const h = stripHop({ ...upres.headers })
			if (typeof h["content-security-policy"] === "string") h["content-security-policy"] = patchCsp(h["content-security-policy"])
			if (h.location?.startsWith(s.url.origin)) h.location = own + h.location.slice(s.url.origin.length)
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
		proxied.on("error", (e: NodeJS.ErrnoException) => {
			if (res.headersSent) return res.destroy()
			if (retry && e.code === "ECONNREFUSED")
				return void startService().then(() => send(false), (e) => fail(502, e.message))
			fail(502, e)
		})
		// a client gone mid-response (a closed event stream) ends the upstream request
		res.on("close", () => {
			if (!res.writableFinished) proxied.destroy()
		})
		if (req.readableEnded) proxied.end()
		else req.pipe(proxied)
	}
	await send(req.method === "GET" || req.method === "HEAD")
})

// WebSockets: the request head, rewritten the same way, then raw bytes
server.on("upgrade", async (req, socket, head) => {
	socket.on("error", () => socket.destroy())
	const own = `http://${req.headers.host?.toLowerCase()}`
	if (!origins.has(own)) return socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n")
	const s = await service().catch(() => undefined)
	if (!s || socket.destroyed) return socket.destroy()
	const lines = Object.entries(outgoing(req.headers, s, own)).flatMap(([k, v]) => [v].flat().map((v) => `${k}: ${v}\r\n`))
	// URL keeps an IPv6 host's brackets; a socket takes the bare address
	const conn = connect(Number(s.url.port) || 80, s.url.hostname.replace(/^\[(.*)\]$/, "$1"), () => {
		conn.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("")}\r\n`)
		conn.write(head)
		socket.pipe(conn).pipe(socket)
	})
	conn.on("error", () => socket.destroy())
	conn.on("close", () => socket.destroy())
	socket.on("close", () => conn.destroy())
})

// a taken port fails the unit, which systemd retries
server.on("error", (e) => {
	console.error(e)
	process.exit(1)
})
server.listen(PORT, "127.0.0.1", () => console.error(`listening on http://127.0.0.1:${PORT}`))
