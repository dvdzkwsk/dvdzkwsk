import {ApiEndpoint, ApiRequest} from "@dvdzkwsk/util/ApiUtil"
import {describe, expect, test} from "bun:test"
import {
	ApiTokenSchema,
	CodeLanguage,
	generateApiToken,
	getEndpointDocs,
	getTypeIndex,
	highlightCode,
} from "./ApiDocs.js"
import * as ApiJson from "../shared/ApiJson.js"

/** Only this site's own pages call these, so /api leaves them out */
const INTERNAL_ENDPOINTS: ApiEndpoint<ApiRequest, unknown>[] = [
	ApiJson.LOG_ENDPOINT,
	ApiJson.RUN_BENCHMARK_ENDPOINT,
]

const documented = ApiJson.API_DOCS_SECTIONS.flatMap((s) => s.endpoints)
const all = Object.entries(ApiJson).filter(([name]) =>
	name.endsWith("_ENDPOINT"),
) as [string, ApiEndpoint<ApiRequest, unknown>][]

describe("API_DOCS_SECTIONS", () => {
	test.each(all)("%s is documented or internal", (_, endpoint) => {
		const count = documented.filter((e) => e === endpoint).length
		expect(INTERNAL_ENDPOINTS.includes(endpoint) ? 0 : 1).toBe(count)
	})

	test("anchors are unique", () => {
		const ids = documented.map((e) => getEndpointDocs(e, "").id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})

describe.each(all)("%s", (_, endpoint) => {
	test("its example request is valid", () => {
		const result = endpoint.requestSchema.safeParse(endpoint.exampleRequest)
		expect(result.error).toBeUndefined()
	})

	test("every param has a description", () => {
		const docs = getEndpointDocs(endpoint, "")
		for (const param of docs.params) {
			expect({name: param.name, description: param.description}).toEqual({
				name: param.name,
				description: expect.any(String),
			})
		}
	})
})

describe("LIST_GAMES_ENDPOINT", () => {
	const parse = (request: object) =>
		ApiJson.LIST_GAMES_ENDPOINT.requestSchema.safeParse(request).success

	test("takes one day, or a range up to the limit", () => {
		expect(parse({from: "2026-10-11"})).toBe(true)
		expect(parse({from: "2026-10-01", to: "2026-10-31"})).toBe(true)
		expect(parse({from: "2026-10-01", to: "2026-11-01"})).toBe(false)
	})

	test("rejects a range that ends before it starts", () => {
		expect(parse({from: "2026-10-11", to: "2026-10-10"})).toBe(false)
	})

	test("a malformed date gets one error, not range errors too", () => {
		const result = ApiJson.LIST_GAMES_ENDPOINT.requestSchema.safeParse({
			from: "tomorrow",
		})
		expect(result.error?.issues.map((issue) => issue.path)).toEqual([
			["from"],
		])
	})
})

describe("API tokens", () => {
	test("a generated token matches the schema, and each is new", () => {
		const token = generateApiToken()
		expect(ApiTokenSchema.safeParse(token).success).toBe(true)
		expect(generateApiToken()).not.toBe(token)
	})

	test("the examples send a generated token as written", () => {
		const token = generateApiToken()
		const docs = getEndpointDocs(ApiJson.SEARCH_ENDPOINT, "", token)
		expect(docs.curl).toContain(`-H 'Authorization: Bearer ${token}'`)
		expect(docs.fetch).toContain(`Authorization: "Bearer ${token}"`)
		expect(docs.curl).not.toContain("KHL_API_TOKEN")
	})
})

describe("getEndpointDocs", () => {
	const docs = getEndpointDocs(
		ApiJson.GET_PLAYER_ACTIVITY_ENDPOINT,
		"https://example.com",
	)

	test("puts path params in the path and the rest in the query", () => {
		expect(
			docs.params.map((p) => [p.name, p.location, p.required]),
		).toEqual([
			["playerId", "path", true],
			["kinds", "query", false],
			["days", "query", false],
			["limit", "query", false],
		])
		expect(docs.curl).toBe(
			[
				"curl 'https://example.com/api/players/1f4d54d9-8b87-4b49-8880-04cd9497ef92/activity?kinds=goal%2Cassist' \\",
				'  -H "Authorization: Bearer $KHL_API_TOKEN"',
			].join("\n"),
		)
		expect(docs.fetch).toContain(
			"headers: {Authorization: `Bearer ${process.env.KHL_API_TOKEN}`}",
		)
	})

	test("names the types params use, and indexes them", () => {
		expect(docs.params[1]!.type).toBe("ActivityKind[]")
		const kind = getTypeIndex([docs]).find((e) => e.name === "ActivityKind")
		expect(kind?.code).toBe(
			'type ActivityKind = "goal" | "assist" | "penalty" | "played" | "skipped"',
		)
		expect(kind?.usedBy).toEqual([docs])
	})

	test("declares the response type first, then the types it uses", () => {
		expect(docs.response.name).toBe("ActivityResponse")
		expect(docs.response.declarations[0]).toEqual({
			name: "ActivityResponse",
			code: [
				"interface ActivityResponse {",
				"  games: ActivityGame[]",
				"  playerIds: Record<string, string>",
				"}",
			].join("\n"),
		})
		expect(docs.response.declarations).toContainEqual({
			name: "ActivityAttendance",
			code: 'type ActivityAttendance = "played" | "skipped"',
		})
	})

	test("indexes each type once, with the endpoints that use it", () => {
		const team = getEndpointDocs(ApiJson.GET_TEAM_ENDPOINT, "")
		const index = getTypeIndex([docs, team])
		const names = index.map((entry) => entry.name)
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
		expect(new Set(names).size).toBe(names.length)
		const usedBy = (name: string) =>
			index.find((e) => e.name === name)?.usedBy.map((d) => d.id)
		expect(usedBy("LiveBarnLink")).toEqual([docs.id, team.id])
		expect(usedBy("TeamResponse")).toEqual([team.id])
	})

	test("sends a POST request's params as its JSON body", () => {
		const log = getEndpointDocs(ApiJson.LOG_ENDPOINT, "https://example.com")
		expect(log.params.every((p) => p.location === "body")).toBe(true)
		expect(log.body?.name).toBe("LogRequest")
		expect(log.curl).toStartWith(
			"curl -X POST 'https://example.com/api/logs' \\\n  -H \"Authorization: Bearer $KHL_API_TOKEN\" \\\n  -H 'Content-Type: application/json' \\\n  -d '{",
		)
	})
})

describe("highlightCode", () => {
	const kinds = (code: string, language: CodeLanguage) => {
		const tokens = highlightCode(code, language)
		expect(tokens.map((t) => t.text).join("")).toBe(code)
		return tokens
			.filter((t) => t.kind !== "plain" && t.kind !== "punctuation")
			.map((t) => [t.kind, t.text])
	}

	test("TypeScript", () => {
		expect(
			kinds("interface A {\n  b?: string | null // uri\n}", "ts"),
		).toEqual([
			["keyword", "interface"],
			["definition", "A"],
			["property", "b"],
			["builtin", "string"],
			["keyword", "null"],
			["comment", "// uri"],
		])
	})

	test("a property named type isn't the type keyword", () => {
		expect(kinds("interface A {\n  type: string\n}", "ts")).toEqual([
			["keyword", "interface"],
			["definition", "A"],
			["property", "type"],
			["builtin", "string"],
		])
	})

	test("JSON keys and values", () => {
		expect(kinds('{"a": "b", "n": 1, "x": null}', "json")).toEqual([
			["property", '"a"'],
			["string", '"b"'],
			["property", '"n"'],
			["number", "1"],
			["property", '"x"'],
			["keyword", "null"],
		])
	})

	test("a URL in a shell command isn't a comment", () => {
		expect(kinds("curl -X GET http://example.com/api", "shell")).toEqual([
			["function", "curl"],
			["keyword", "-X"],
		])
	})
})
