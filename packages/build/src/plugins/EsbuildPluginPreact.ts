import {createRequire} from "node:module"
import alias from "esbuild-plugin-alias"

export function EsbuildPluginPreact() {
	const require = createRequire(import.meta.url)
	return alias({
		react: require.resolve("preact/compat"),
		"react-dom": require.resolve("preact/compat"),
		"react-dom/client": require.resolve("preact/compat/client"),
		"react/jsx-runtime": require.resolve("preact/jsx-runtime"),
	})
}
