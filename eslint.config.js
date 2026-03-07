import js from "@eslint/js"
import tseslint from "@typescript-eslint/eslint-plugin"
import tsparser from "@typescript-eslint/parser"
import prettier from "eslint-plugin-prettier"
import prettierConfig from "eslint-config-prettier"
import importPlugin from "eslint-plugin-import"
import unusedImports from "eslint-plugin-unused-imports"
import globals from "globals"

export default [
	js.configs.recommended,
	prettierConfig,
	{
		files: ["**/*.ts", "**/*.tsx"],
		plugins: {
			"@typescript-eslint": tseslint,
			prettier: prettier,
			import: importPlugin,
			"unused-imports": unusedImports,
		},
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: "latest",
				sourceType: "module",
			},
			globals: {
				...globals.node,
			},
		},
		rules: {
			...tseslint.configs.recommended.rules,
			"no-undef": "off", // TypeScript handles this better
			"prettier/prettier": "error",
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-empty-object-type": "off",
			"unused-imports/no-unused-imports": "error",
			"unused-imports/no-unused-vars": [
				"error",
				{
					vars: "all",
					varsIgnorePattern: "^_",
					args: "after-used",
					argsIgnorePattern: "^_",
				},
			],
			"@typescript-eslint/explicit-function-return-type": "off",
			"@typescript-eslint/no-explicit-any": "warn",
			"import/order": [
				"error",
				{
					groups: [
						"builtin",
						"external",
						"internal",
						["parent", "sibling", "index"],
					],
					"newlines-between": "never",
					alphabetize: {
						order: "asc",
						caseInsensitive: true,
					},
				},
			],
		},
	},
	{
		files: ["pkg/webapp/**/*.ts", "pkg/webapp/**/*.tsx", "pkg/api/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.browser,
			},
		},
	},
	{
		files: [
			"pkg/backend/**/*.ts",
			"tools/**/*.ts",
			"pkg/webapp/Main.dev.ts",
		],
		languageOptions: {
			globals: {
				...globals.node,
				Bun: "readonly",
			},
		},
	},
	{
		files: ["**/*.js"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		ignores: ["node_modules/**", "dist/**", "pkg/**/static/**"],
	},
]
