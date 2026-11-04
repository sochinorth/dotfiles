// Builds tool-descriptions' desktop GUI part. Its dependencies live here, not in
// the plugin: OpenCode watches a local plugin's whole directory, node_modules
// and all. The app provides solid-js and @opencode/* to GUI bundles at runtime.
import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

const plugin = new URL("../plugins/tool-descriptions/", import.meta.url).pathname

export default defineConfig({
	plugins: [gui({ entry: `${plugin}gui/gui.tsx`, outFile: `${plugin}dist/gui-experimental.cjs` })],
})
