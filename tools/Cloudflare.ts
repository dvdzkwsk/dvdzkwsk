import {z} from "zod"
import {Logger} from "../pkg/logger/Logger.js"
import {doFetch, FetchError} from "../pkg/util/FetchUtil.js"

const logger = new Logger("Cloudflare")

const API_URL = "https://api.cloudflare.com/client/v4"

/**
 * Cloudflare API client. The token needs, for the zone: Zone Read, DNS Edit,
 * and Config Rules Edit (for Configuration Rules).
 */
export class Cloudflare {
	constructor(private readonly token: string) {}

	/** The zone that `hostname` belongs to, e.g. dvdzkwsk.com for khl.dvdzkwsk.com */
	async findZone(hostname: string): Promise<Zone> {
		const zones = await this.request(
			"GET",
			"/zones?per_page=50",
			z.array(ZoneSchema),
		)
		const zone = zones
			.filter(
				(z) => hostname === z.name || hostname.endsWith(`.${z.name}`),
			)
			.sort((a, b) => b.name.length - a.name.length)[0]
		if (!zone) {
			throw logger.newError(
				"findZone",
				"no zone the token can access contains the hostname",
				{
					hostname,
					zones: zones.map((z) => z.name),
				},
			)
		}
		return zone
	}

	/**
	 * Makes `name`'s A, AAAA, and CNAME records exactly `records`: matching
	 * ones are kept (or updated), missing ones created, and the rest deleted.
	 */
	async syncDnsRecords(zone: Zone, name: string, records: DnsRecordInput[]) {
		const existing = (
			await this.request(
				"GET",
				`/zones/${zone.id}/dns_records?name=${encodeURIComponent(name)}&per_page=100`,
				z.array(DnsRecordSchema),
			)
		).filter((r) => SYNCED_TYPES.includes(r.type))

		const unmatched = [...existing]
		const toCreate: DnsRecordInput[] = []
		for (const record of records) {
			const i = unmatched.findIndex(
				(r) =>
					r.type === record.type &&
					sameContent(r.content, record.content),
			)
			if (i === -1) {
				toCreate.push(record)
				continue
			}
			const [match] = unmatched.splice(i, 1)
			if (match!.proxied !== record.proxied) {
				logger.info("syncDnsRecords", "updating DNS record", {
					name,
					...record,
				})
				await this.request(
					"PATCH",
					`/zones/${zone.id}/dns_records/${match!.id}`,
					z.unknown(),
					{proxied: record.proxied},
				)
			}
		}
		// Delete first: a CNAME can't coexist with other records at a name
		for (const record of unmatched) {
			logger.info("syncDnsRecords", "deleting DNS record", {
				name,
				type: record.type,
				content: record.content,
			})
			await this.request(
				"DELETE",
				`/zones/${zone.id}/dns_records/${record.id}`,
				z.unknown(),
			)
		}
		for (const record of toCreate) {
			logger.info("syncDnsRecords", "creating DNS record", {
				name,
				...record,
			})
			await this.request(
				"POST",
				`/zones/${zone.id}/dns_records`,
				z.unknown(),
				{
					name,
					ttl: 1, // automatic
					...record,
				},
			)
		}
	}

	/**
	 * Adds or updates a Configuration Rule, identified by `rule.ref`, leaving
	 * the zone's other rules alone.
	 */
	async upsertConfigRule(zone: Zone, rule: ConfigRule) {
		const entrypoint = `/zones/${zone.id}/rulesets/phases/http_config_settings/entrypoint`
		let ruleset: Ruleset
		try {
			ruleset = await this.request("GET", entrypoint, RulesetSchema)
		} catch (error) {
			if (!(error instanceof FetchError && error.status === 404)) {
				throw error
			}
			logger.info("upsertConfigRule", "creating config rules ruleset", {
				ref: rule.ref,
			})
			await this.request("PUT", entrypoint, z.unknown(), {rules: [rule]})
			return
		}
		const existing = ruleset.rules?.find((r) => r.ref === rule.ref)
		if (!existing) {
			logger.info("upsertConfigRule", "creating config rule", {
				ref: rule.ref,
			})
			await this.request(
				"POST",
				`/zones/${zone.id}/rulesets/${ruleset.id}/rules`,
				z.unknown(),
				rule,
			)
		} else if (
			existing.expression !== rule.expression ||
			existing.enabled !== rule.enabled ||
			JSON.stringify(existing.action_parameters) !==
				JSON.stringify(rule.action_parameters)
		) {
			logger.info("upsertConfigRule", "updating config rule", {
				ref: rule.ref,
			})
			await this.request(
				"PATCH",
				`/zones/${zone.id}/rulesets/${ruleset.id}/rules/${existing.id}`,
				z.unknown(),
				rule,
			)
		}
	}

	/** Calls the API and unwraps its {success, result} envelope. */
	private async request<T>(
		method: "GET" | "DELETE" | "POST" | "PUT" | "PATCH",
		pathname: string,
		resultSchema: z.ZodType<T>,
		body?: unknown,
	): Promise<T> {
		const url = `${API_URL}${pathname}`
		const headers = {Authorization: `Bearer ${this.token}`}
		const responseSchema = z.object({result: resultSchema})
		const response =
			method === "GET" || method === "DELETE"
				? await doFetch({method, url, headers, responseSchema})
				: await doFetch({
						method,
						url,
						headers,
						requestBody: body,
						requestSchema: z.unknown(),
						responseSchema,
					})
		return response.result
	}
}

export interface Zone {
	id: string
	name: string
}

export interface DnsRecordInput {
	type: "A" | "AAAA" | "CNAME"
	content: string
	proxied: boolean
}

export interface ConfigRule {
	ref: string
	description: string
	expression: string
	action: "set_config"
	action_parameters: Record<string, unknown>
	enabled: boolean
}

const SYNCED_TYPES: string[] = ["A", "AAAA", "CNAME"]

const ZoneSchema = z.object({id: z.string(), name: z.string()})

const DnsRecordSchema = z.object({
	id: z.string(),
	type: z.string(),
	content: z.string(),
	proxied: z.boolean().optional(),
})

const RulesetSchema = z.object({
	id: z.string(),
	rules: z
		.array(
			z.object({
				id: z.string(),
				ref: z.string().optional(),
				expression: z.string().optional(),
				enabled: z.boolean().optional(),
				action_parameters: z.unknown().optional(),
			}),
		)
		.optional(),
})
type Ruleset = z.infer<typeof RulesetSchema>

/** DNS names compare case-insensitively and with or without a trailing dot. */
function sameContent(a: string, b: string): boolean {
	const normalize = (s: string) => s.toLowerCase().replace(/\.$/, "")
	return normalize(a) === normalize(b)
}
