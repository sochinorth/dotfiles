// Builds a plugin's desktop GUI part: PLUGIN names its directory under
// ../plugins, and `bun run build` builds each one. Their dependencies live
// here, not in the plugins: OpenCode watches a local plugin's whole directory,
// node_modules and all. The app provides solid-js and @opencode/* to GUI
// bundles at runtime.
import { existsSync } from "node:fs"
import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

const name = process.env.PLUGIN
if (!name) throw new Error("PLUGIN: which plugin's GUI to build (a directory in ../plugins)")
const plugin = new URL(`../plugins/${name}/`, import.meta.url).pathname
const entry = ["gui/gui.tsx", "gui/gui.ts"].map((f) => plugin + f).find(existsSync)
if (!entry) throw new Error(`${plugin} has no gui/gui.tsx or gui/gui.ts`)

export default defineConfig({
	plugins: [gui({ entry, outFile: `${plugin}dist/gui-experimental.cjs` })],
})
