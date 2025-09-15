import path from "path"
import {defineConfig} from "vite"

export default defineConfig({
	root: __dirname,
	publicDir: path.join(__dirname, "static"),
	build: {
		outDir: path.join(__dirname, "../../dist/website"),
	},
	server: {
		port: process.env.PORT ?? 3000,
	},
})
