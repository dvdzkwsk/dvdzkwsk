import {ApiEndpoint, ApiRequest, toHttpRequest} from "@dvdzkwsk/util/ApiUtil"
import {z} from "zod"
import * as ApiJson from "../shared/ApiJson.js"
import * as KHLJson from "../shared/KHLJson.js"

// --- Docs for the /api page, derived from the ApiJson.ts endpoint objects
//
// Types are rendered from the zod schemas (via JSON Schema), so they can't
// drift from what the server validates. A schema exported as `FooSchema` from
// ApiJson.ts or KHLJson.ts is named `Foo` and declared once; descriptions come
// from `.describe()`.

type JSONSchema = z.core.JSONSchema._JSONSchema

export interface ApiParamDocs {
	name: string
	/** Where the param goes: the path, the query string, or the JSON body */
	location: "path" | "query" | "body"
	/** A TypeScript type, with named enums spelled out */
	type: string
	required: boolean
	description: string | null
}

export interface ApiTypeDocs {
	/** The root type's name */
	name: string
	/** The root type first, then the types it uses */
	declarations: ApiTypeDeclaration[]
}

export interface ApiTypeDeclaration {
	name: string
	/** A TypeScript `interface` or `type` */
	code: string
}

/** One named type on the page, and the endpoints that use it */
export interface ApiTypeEntry extends ApiTypeDeclaration {
	usedBy: ApiEndpointDocs[]
}

export interface ApiEndpointDocs {
	endpoint: ApiEndpoint<ApiRequest, unknown>
	/** The section's anchor */
	id: string
	params: ApiParamDocs[]
	/**
	 * The named types the params use, e.g. ActivityKind. The request type
	 * itself is left out, since the params table already shows it.
	 */
	paramTypes: ApiTypeDeclaration[]
	/** POST/PUT/PATCH only */
	body: ApiTypeDocs | null
	response: ApiTypeDocs
	curl: string
	fetch: string
}

/** Every `*Schema` export, named without the suffix */
const TYPE_NAMES = (() => {
	const registry = z.registry<{id: string}>()
	for (const [exportName, value] of Object.entries({
		...KHLJson,
		...ApiJson,
	})) {
		if (exportName.endsWith("Schema") && value instanceof z.ZodType) {
			registry.add(value, {id: exportName.slice(0, -"Schema".length)})
		}
	}
	return registry
})()

/**
 * `origin` prefixes the example URLs, e.g. "https://khl.dvdzkwsk.com", and
 * the examples send `token`, or read one from API_TOKEN_ENV_VAR if it's null
 */
export function getEndpointDocs(
	endpoint: ApiEndpoint<ApiRequest, unknown>,
	origin: string,
	token: string | null = null,
): ApiEndpointDocs {
	const request = toTypeDocs(endpoint.requestSchema)
	const response = toTypeDocs(endpoint.responseSchema)
	const hasBody = endpoint.method !== "GET" && endpoint.method !== "DELETE"
	return {
		endpoint,
		id: toAnchor(endpoint.name),
		params: getParams(endpoint, request.schema, hasBody),
		paramTypes: request.docs.declarations.filter(
			(d) => d.name !== request.docs.name,
		),
		body: hasBody ? request.docs : null,
		response: response.docs,
		...getExamples(endpoint, response.docs.name, origin, token),
	}
}

/**
 * Every type the endpoints use, by name. A type has the same declaration
 * wherever it's used, since it comes from the same schema.
 */
export function getTypeIndex(endpoints: ApiEndpointDocs[]): ApiTypeEntry[] {
	const entries = new Map<string, ApiTypeEntry>()
	for (const docs of endpoints) {
		const declarations = [
			...(docs.body?.declarations ?? []),
			...docs.paramTypes,
			...docs.response.declarations,
		]
		for (const declaration of declarations) {
			let entry = entries.get(declaration.name)
			if (!entry) {
				entry = {...declaration, usedBy: []}
				entries.set(declaration.name, entry)
			}
			if (!entry.usedBy.includes(docs)) {
				entry.usedBy.push(docs)
			}
		}
	}
	return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** A named type's anchor on the /api page */
export function toTypeAnchor(name: string): string {
	return `type-${name}`
}

export function toAnchor(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
}

// --- Params

function getParams(
	endpoint: ApiEndpoint<ApiRequest, unknown>,
	schema: ResolvedSchema,
	hasBody: boolean,
): ApiParamDocs[] {
	const root = schema.resolve(schema.root)
	if (typeof root !== "object") {
		return []
	}
	const required = new Set(root.required ?? [])
	return Object.entries(root.properties ?? {}).map(([name, property]) => {
		const inPath = endpoint.uri.includes(`:${name}`)
		return {
			name,
			location: inPath ? "path" : hasBody ? "body" : "query",
			type: renderType(property, schema, {}),
			required: required.has(name),
			description: getDescription(property),
		}
	})
}

// --- Types

interface ResolvedSchema {
	root: JSONSchema
	defs: Record<string, JSONSchema>
	/** Follows a $ref, if `schema` is one */
	resolve: (schema: JSONSchema) => JSONSchema
}

function toTypeDocs(schema: z.ZodType): {
	schema: ResolvedSchema
	docs: ApiTypeDocs
} {
	const json = z.toJSONSchema(schema, {
		metadata: TYPE_NAMES,
		// Request types too: the server's parsed request is what the docs show
		io: "output",
		unrepresentable: "any",
		override: ({zodSchema, jsonSchema}) => {
			const description = z.globalRegistry.get(zodSchema)?.description
			if (description) {
				jsonSchema.description = description
			}
		},
	})
	const {$defs: defs = {}, ...root} = json
	const resolved: ResolvedSchema = {
		root,
		defs,
		resolve: (s) => {
			const name = getRefName(s)
			return name ? (defs[name] ?? {}) : s
		},
	}
	// Every request and response schema is exported, so the root is a $ref
	const name = getRefName(root) ?? "Response"
	const declarations: ApiTypeDeclaration[] = []
	for (const defName of collectRefs(root, defs)) {
		declarations.push({
			name: defName,
			code: renderDeclaration(defName, defs[defName]!, resolved),
		})
	}
	if (!getRefName(root)) {
		declarations.unshift({
			name,
			code: renderDeclaration(name, root, resolved),
		})
	}
	return {schema: resolved, docs: {name, declarations}}
}

function getRefName(schema: JSONSchema): string | null {
	return typeof schema === "object" && schema.$ref
		? schema.$ref.replace("#/$defs/", "")
		: null
}

/** Names of the defs `root` uses, directly or not, in the order first seen */
function collectRefs(
	root: JSONSchema,
	defs: Record<string, JSONSchema>,
): string[] {
	const seen = new Set<string>()
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			value.forEach(visit)
			return
		}
		if (!value || typeof value !== "object") {
			return
		}
		const name = getRefName(value as JSONSchema)
		if (name && !seen.has(name)) {
			seen.add(name)
			visit(defs[name])
		}
		Object.values(value).forEach(visit)
	}
	visit(root)
	return [...seen]
}

function getDescription(schema: JSONSchema): string | null {
	return typeof schema === "object" ? (schema.description ?? null) : null
}

const INDENT = "  "

function renderDeclaration(
	name: string,
	schema: JSONSchema,
	resolved: ResolvedSchema,
): string {
	const doc = renderDocComment(getDescription(schema), "")
	if (typeof schema === "object" && schema.type === "object") {
		if (schema.properties && Object.keys(schema.properties).length > 0) {
			return `${doc}interface ${name} ${renderType(schema, resolved, {})}`
		}
	}
	return `${doc}type ${name} = ${renderType(schema, resolved, {})}`
}

function renderDocComment(description: string | null, indent: string) {
	return description ? `${indent}/** ${description} */\n` : ""
}

interface RenderOptions {
	indent?: string
}

function renderType(
	schema: JSONSchema,
	resolved: ResolvedSchema,
	options: RenderOptions,
): string {
	if (typeof schema === "boolean") {
		return schema ? "unknown" : "never"
	}
	const indent = options.indent ?? ""
	const refName = getRefName(schema)
	if (refName) {
		return refName
	}
	if (schema.const !== undefined) {
		return JSON.stringify(schema.const)
	}
	if (schema.enum) {
		return schema.enum.map((value) => JSON.stringify(value)).join(" | ")
	}
	const union = schema.anyOf ?? schema.oneOf
	if (union) {
		return [
			...new Set(union.map((s) => renderType(s, resolved, options))),
		].join(" | ")
	}
	if (schema.allOf) {
		return schema.allOf
			.map((s) => renderType(s, resolved, options))
			.join(" & ")
	}
	if (Array.isArray(schema.type)) {
		return schema.type
			.map((type) => renderType({...schema, type}, resolved, options))
			.join(" | ")
	}
	switch (schema.type) {
		case "string":
		case "boolean":
		case "null":
			return schema.type
		case "number":
		case "integer":
			return "number"
		case "array": {
			// A tuple: draft 2020-12 `prefixItems`, or older drafts' `items` list
			const tuple =
				schema.prefixItems ??
				(Array.isArray(schema.items) ? schema.items : null)
			if (tuple) {
				const items = tuple.map((s) => renderType(s, resolved, options))
				return `[${items.join(", ")}]`
			}
			const item = renderType(
				(schema.items as JSONSchema | undefined) ?? {},
				resolved,
				options,
			)
			return /[ |&]/.test(item) ? `(${item})[]` : `${item}[]`
		}
		case "object":
			return renderObject(schema, resolved, {...options, indent})
	}
	return "unknown"
}

function renderObject(
	schema: z.core.JSONSchema.JSONSchema,
	resolved: ResolvedSchema,
	options: RenderOptions,
): string {
	const indent = options.indent ?? ""
	const properties = Object.entries(schema.properties ?? {})
	if (properties.length === 0) {
		const values = schema.additionalProperties
		if (values && typeof values === "object") {
			return `Record<string, ${renderType(values, resolved, options)}>`
		}
		return values === false
			? "Record<string, never>"
			: "Record<string, unknown>"
	}
	const required = new Set(schema.required ?? [])
	const inner = indent + INDENT
	const lines = properties.map(([key, property]) => {
		const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
		const optional = required.has(key) ? "" : "?"
		const type = renderType(property, resolved, {...options, indent: inner})
		const doc = renderDocComment(getDescription(property), inner)
		const format = renderFormatComment(resolved.resolve(property))
		return `${doc}${inner}${name}${optional}: ${type}${format}`
	})
	return `{\n${lines.join("\n")}\n${indent}}`
}

/** What a plain `string` must look like, e.g. "// uuid" */
function renderFormatComment(schema: JSONSchema): string {
	if (typeof schema !== "object") {
		return ""
	}
	// A nullable string: its format is on the non-null member
	const member = (schema.anyOf ?? []).find(
		(s) => typeof s === "object" && s.type === "string",
	)
	const target = typeof member === "object" ? member : schema
	return target.type === "string" && target.format
		? ` // ${target.format}`
		: ""
}

// --- Examples

function getExamples(
	endpoint: ApiEndpoint<ApiRequest, unknown>,
	responseName: string,
	origin: string,
	token: string | null,
): {curl: string; fetch: string} {
	const {url, body} = toHttpRequest(endpoint, endpoint.exampleRequest)
	const fullUrl = origin + url
	const auth = getAuthHeaders(token)
	if (body === null) {
		return {
			curl: [
				`curl ${quoteShell(fullUrl)} \\`,
				`${INDENT}${auth.curl}`,
			].join("\n"),
			fetch: [
				`const response = await fetch(${JSON.stringify(fullUrl)}, {`,
				`${INDENT}headers: {${auth.fetch}},`,
				`})`,
				`const data: ${responseName} = await response.json()`,
			].join("\n"),
		}
	}
	const json = JSON.stringify(body, null, 2)
	return {
		curl: [
			`curl -X ${endpoint.method} ${quoteShell(fullUrl)} \\`,
			`${INDENT}${auth.curl} \\`,
			`${INDENT}-H 'Content-Type: application/json' \\`,
			`${INDENT}-d ${quoteShell(JSON.stringify(body))}`,
		].join("\n"),
		fetch: [
			`const response = await fetch(${JSON.stringify(fullUrl)}, {`,
			`${INDENT}method: ${JSON.stringify(endpoint.method)},`,
			`${INDENT}headers: {`,
			`${INDENT}${INDENT}${auth.fetch},`,
			`${INDENT}${INDENT}"Content-Type": "application/json",`,
			`${INDENT}},`,
			`${INDENT}body: JSON.stringify(${json.replaceAll("\n", `\n${INDENT}`)}),`,
			`})`,
			`const data: ${responseName} = await response.json()`,
		].join("\n"),
	}
}

// --- API tokens. Every request sends one as a Bearer token. The server doesn't
// issue or check them yet, so the page makes one in the browser.

/**
 * Where the examples read the caller's API token from, until they've
 * generated one on the page
 */
export const API_TOKEN_ENV_VAR = "KHL_API_TOKEN"

const API_TOKEN_PREFIX = "khl_"

/** 24 random bytes, base64url: 32 characters after the prefix */
export const ApiTokenSchema = z.string().regex(/^khl_[A-Za-z0-9_-]{32}$/)

export function generateApiToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24))
	const base64 = btoa(String.fromCharCode(...bytes))
	return API_TOKEN_PREFIX + base64.replaceAll("+", "-").replaceAll("/", "_")
}

/** The Authorization header's value, with `token` or the env var */
export function getAuthorizationValue(token: string | null): string {
	return `Bearer ${token ?? `$${API_TOKEN_ENV_VAR}`}`
}

/** curl's -H flag and fetch's headers entry for the Authorization header */
function getAuthHeaders(token: string | null): {curl: string; fetch: string} {
	if (token) {
		return {
			curl: `-H ${quoteShell(`Authorization: ${getAuthorizationValue(token)}`)}`,
			fetch: `Authorization: ${JSON.stringify(getAuthorizationValue(token))}`,
		}
	}
	return {
		// Double-quoted, unlike the URL, so the shell expands the variable
		curl: `-H "Authorization: ${getAuthorizationValue(null)}"`,
		fetch: `Authorization: \`Bearer \${process.env.${API_TOKEN_ENV_VAR}}\``,
	}
}

/** Single-quoted for a POSIX shell, so `?`, `&`, and `$` stay literal */
function quoteShell(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`
}

// --- Syntax highlighting, for the code on the /api page

export type CodeLanguage = "ts" | "json" | "shell"

export type CodeTokenKind =
	| "plain"
	| "keyword"
	| "builtin"
	| "type"
	/** The name an `interface` or `type` declares */
	| "definition"
	| "property"
	| "function"
	| "string"
	| "number"
	| "comment"
	| "punctuation"

export interface CodeToken {
	kind: CodeTokenKind
	text: string
}

/** One alternative per token kind; whatever's left is punctuation */
const TOKEN_PATTERN = new RegExp(
	[
		/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/.source,
		/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/.source,
		/(--?[A-Za-z][\w-]*)/.source,
		/(\b\d+(?:\.\d+)?\b)/.source,
		/([A-Za-z_$][\w$]*)/.source,
		/(\s+)/.source,
		/([\s\S])/.source,
	].join("|"),
	"g",
)

const TS_KEYWORDS = new Set([
	"interface",
	"type",
	"const",
	"let",
	"await",
	"async",
	"new",
	"return",
	"true",
	"false",
	"null",
	"undefined",
])

const TS_BUILTINS = new Set([
	"string",
	"number",
	"boolean",
	"unknown",
	"never",
	"object",
])

const JSON_KEYWORDS = new Set(["true", "false", "null"])

/** Splits `code` into tokens; joined back together, they're `code` again */
export function highlightCode(
	code: string,
	language: CodeLanguage,
): CodeToken[] {
	const tokens: CodeToken[] = []
	const push = (kind: CodeTokenKind, text: string) => {
		const last = tokens[tokens.length - 1]
		if (last && last.kind === kind && kind !== "comment") {
			last.text += text
		} else {
			tokens.push({kind, text})
		}
	}
	let isFirstWord = true
	/** The last word if it was `interface` or `type` as a keyword */
	let declaringKeyword = ""
	for (const match of code.matchAll(TOKEN_PATTERN)) {
		const [text, comment, string, flag, number, word, space] = match
		const rest = code.slice(match.index + text.length)
		if (comment) {
			// Only TypeScript has comments; in a shell, "//" is part of a URL
			push(language === "ts" ? "comment" : "plain", text)
		} else if (string) {
			const isKey = language === "json" && /^\s*:/.test(rest)
			push(isKey ? "property" : "string", text)
		} else if (flag) {
			if (language === "shell") {
				push("keyword", text)
			} else {
				// Not a flag outside a shell: a minus, then a word
				const after = text.slice(1)
				push("punctuation", text[0]!)
				push(classifyWord(after, rest, language), after)
			}
		} else if (number) {
			push("number", text)
		} else if (word) {
			const kind =
				language === "shell" && isFirstWord
					? "function"
					: declaringKeyword
						? "definition"
						: classifyWord(word, rest, language)
			push(kind, text)
			isFirstWord = false
			declaringKeyword =
				kind === "keyword" && (word === "interface" || word === "type")
					? word
					: ""
		} else if (space) {
			push("plain", text)
		} else {
			push("punctuation", text)
		}
	}
	return tokens
}

function classifyWord(
	word: string,
	rest: string,
	language: CodeLanguage,
): CodeTokenKind {
	if (language === "json") {
		return JSON_KEYWORDS.has(word) ? "keyword" : "plain"
	}
	if (language === "shell") {
		return "plain"
	}
	// Before keywords: a property can be named "type"
	if (/^\??:/.test(rest)) {
		return "property"
	}
	if (TS_KEYWORDS.has(word)) {
		return "keyword"
	}
	if (TS_BUILTINS.has(word)) {
		return "builtin"
	}
	if (/^\s*\(/.test(rest)) {
		return "function"
	}
	return /^[A-Z]/.test(word) ? "type" : "plain"
}
