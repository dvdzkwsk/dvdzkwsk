import {Logger} from "@dvdzkwsk/logger"
import {deepEqual, execScript} from "./_util.js"
import {
	CloudflareConfig,
	getCloudflareConfig,
	getWebsiteConfig,
} from "./_config.js"
import {buildWebsite} from "./build-website.js"

const logger = new Logger("DeployWebsite")

async function deployWebsite() {
	const websiteConfig = getWebsiteConfig()

	const cloudflareConfig = getCloudflareConfig()
	cloudflareConfig.zoneId = websiteConfig.cloudflareZoneId
	cloudflareConfig.domain = websiteConfig.domain

	if (process.argv.includes("--build")) {
		await buildWebsite(websiteConfig)
	}
	if (!process.argv.includes("--skip-infra")) {
		await ensureCloudflareInfra(cloudflareConfig)
	}
	// TODO: allow manual deployment to netlify
}

async function ensureCloudflareInfra(cloudflareConfig: CloudflareConfig) {
	if (!cloudflareConfig.domain) {
		throw logger.newError(
			"ensureCloudflareInfra",
			"missing required config property: domain",
		)
	}
	if (!cloudflareConfig.zoneId) {
		throw logger.newError(
			"ensureCloudflareInfra",
			"missing required config property: zoneId",
		)
	}
	const ctx: CloudflareAPIContext = {
		cloudflare: cloudflareConfig,
	}
	const pageRules: CloudflarePageRule[] = []
	if (pageRules.length) {
		await ensureCloudflarePageRules(pageRules, ctx)
	}
}

interface CloudflarePageRule {
	id?: string
	status?: "active" | "disabled"
	targets: {
		target: string
		constraint: {
			operator: string
			value: string
		}
	}[]
	actions: {
		id: string
		value: unknown
	}[]
}

async function ensureCloudflarePageRules(
	pageRules: CloudflarePageRule[],
	ctx: CloudflareAPIContext,
) {
	logger.debug("ensureCloudflarePageRules", "ensuring page rules...")
	const pageRulesRes = await doCloudflareRequest<CloudflarePageRule[]>(
		{
			url: `https://api.cloudflare.com/client/v4/zones/${ctx.cloudflare.zoneId}/pagerules`,
		},
		ctx,
	)
	const missingRules: CloudflarePageRule[] = []
	const disabledRules: CloudflarePageRule[] = []

	for (const rule of pageRules) {
		const match = pageRulesRes.json.result.find((r) =>
			deepEqual(
				{
					targets: r.targets,
					actions: r.actions,
				},
				rule,
			),
		)
		if (!match) {
			missingRules.push(rule)
		} else if (match.status === "disabled") {
			disabledRules.push(match)
		}
	}
	if (!missingRules.length && !disabledRules.length) {
		logger.debug(
			"ensureCloudflarePageRules",
			"all page rules are already configured and active",
		)
		return
	}
	if (missingRules.length) {
		logger.debug(
			"ensureCloudflarePageRules",
			`Creating ${missingRules.length} missing rule(s)...`,
			{missingRules},
		)
		for (const rule of missingRules) {
			const res = await doCloudflareRequest<CloudflarePageRule[]>(
				{
					url: `https://api.cloudflare.com/client/v4/zones/${ctx.cloudflare.zoneId}/pagerules`,
					method: "POST",
					body: JSON.stringify(rule),
				},
				ctx,
			)
			if (!res.json.success) {
				throw logger.newError(
					"ensureCloudflarePageRules",
					"failed to create page rule",
					{rule, res},
				)
			}
		}
	}
	if (disabledRules.length) {
		logger.debug(
			"ensureCloudflarePageRules",
			`Enabling ${disabledRules.length} disabled rule(s)...`,
			{disabledRules},
		)
		for (const rule of disabledRules) {
			const res = await doCloudflareRequest<CloudflarePageRule[]>(
				{
					url: `https://api.cloudflare.com/client/v4/zones/${ctx.cloudflare.zoneId}/pagerules/${rule.id}`,
					method: "PATCH",
					body: JSON.stringify({status: "active"}),
				},
				ctx,
			)
			if (!res.json.success) {
				throw logger.newError(
					"ensureCloudflarePageRules",
					"failed to enable page rule",
					{rule, res},
				)
			}
		}
	}
}

interface CloudflareAPIContext {
	cloudflare: CloudflareConfig & {zoneId: string}
}

interface CloudflareAPIResult<T = any> {
	result: T
	success: boolean
	errors: unknown[]
	messages: unknown[]
}
async function doCloudflareRequest<T = unknown>(
	request: RequestInit & {url: string},
	context: CloudflareAPIContext,
): Promise<{
	res: Response
	json: CloudflareAPIResult<T>
}> {
	const res = await fetch(request.url, {
		...request,
		headers: {
			Authorization: `Bearer ${context.cloudflare.apiToken}`,
			"Content-Type": "application/json",
			...request.headers,
		},
	})
	const json = await res.json()
	return {res, json}
}

execScript(import.meta, deployWebsite)
