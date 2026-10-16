import path from "path"
import {defineConfig} from "vite"

export default defineConfig({
	root: path.join(import.meta.dirname, "src"),
	publicDir: path.join(import.meta.dirname, "static"),
	build: {
		outDir: path.join(import.meta.dirname, "dist/website"),
		emptyOutDir: true,
		rollupOptions: {
			onwarn(warning, warn) {
				// Base UI marks its modules "use client" for Next.js; irrelevant here
				if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
					return
				}
				warn(warning)
			},
		},
	},
	server: {
		port: process.env.PORT ?? 3000,
		proxy: {
			// Server.ts; not "/api" itself, the client's API docs page
			"^/api/": `http://localhost:${process.env.KHL_API_PORT ?? 3001}`,
		},
	},
})
