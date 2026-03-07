import path from "path"
import {defineConfig} from "vite"

export default defineConfig({
	root: import.meta.dirname,
	publicDir: path.join(import.meta.dirname, "static"),
	build: {
		outDir: path.join(import.meta.dirname, "../../dist/website"),
	},
	server: {
		port: process.env.PORT ?? 3000,
	},
})
