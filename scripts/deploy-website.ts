import * as fs from "fs"
import * as path from "path"
import {Logger} from "@dvdzkwsk/logger"
import {Bucket, Storage} from "@google-cloud/storage"
import {deepEqual, execScript, shell} from "./_util.js"
import {
	CloudflareConfig,
	GCPConfig,
	WebsiteConfig,
	getCloudflareConfig,
	getGCPConfig,
	getWebsiteConfig,
} from "./_config.js"
import {buildWebsite} from "./build-website.js"

const logger = new Logger("DeployWebsite")

async function deployWebsite() {
	const websiteConfig = getWebsiteConfig()
	const gcpConfig = getGCPConfig()

	const cloudflareConfig = getCloudflareConfig()
	cloudflareConfig.zoneId = websiteConfig.cloudflareZoneId
	cloudflareConfig.domain = websiteConfig.domain

	if (process.argv.includes("--build")) {
		await buildWebsite(websiteConfig)
	}

	if (!process.argv.includes("--skip-infra")) {
		// await ensureGCPInfra(websiteConfig, gcpConfig)
		await ensureCloudflareInfra(cloudflareConfig)
	}

	// await syncFolderToBucket(
	// 	path.join(websiteConfig.dir, "dist"),
	// 	websiteConfig.gcpBucket!,
	// )
}

async function syncFolderToBucket(folderToSync: string, bucket: string) {
	if (process.argv.includes("--dry")) return

	if (!fs.existsSync(folderToSync)) {
		logger.error(
			"syncFolderToBucket",
			"No dist directory to deploy. Did you forget to build the website?",
			{
				path: folderToSync,
			},
		)
		process.exit(1)
	}

	await shell(
		`gsutil -m -h "Cache-Control:no-cache" rsync -r ${folderToSync} gs://${bucket}`,
	)
}

async function ensureGCPInfra(
	websiteConfig: WebsiteConfig,
	gcpConfig: GCPConfig,
) {
	if (!websiteConfig.gcpBucket) {
		throw logger.newError("ensureGCPInfra", "no gcp bucket configured")
	}
	const storage = new Storage({
		projectId: gcpConfig.projectId,
		keyFilename: gcpConfig.keyFilename,
	})
	const bucket = storage.bucket(websiteConfig.gcpBucket!)

	await ensureServiceAccount(gcpConfig)
	await ensureBucketExists(bucket)
	await shell(`gsutil iam ch allUsers:objectViewer gs://${bucket.name}`)
	await shell(`gsutil web set -m index.html -e 404.html gs://${bucket.name}`)
}

async function ensureServiceAccount(config: GCPConfig) {
	logger.debug("ensureServiceAccount", "ensuring service account exists...")
	await shell(`gcloud iam service-accounts create ${config.serviceAccount}`)

	logger.debug(
		"ensureServiceAccount",
		"ensuring service account has required roles...",
	)
	const roles = ["roles/storage.admin"]
	for (const role of roles) {
		await shell(
			[
				`gcloud projects add-iam-policy-binding ${config.projectId}`,
				`--member='serviceAccount:${config.serviceAccount}@${config.projectId}.iam.gserviceaccount.com'`,
				`--role=${role}`,
			].join(" "),
		)
	}
}

async function ensureBucketExists(bucket: Bucket) {
	logger.debug("ensureBucketExists", "ensuring bucket exists...", {
		bucket: bucket.name,
	})
	if (await bucketExists(bucket)) {
		logger.debug("ensureBucketExists", "bucket already exists", {
			bucket: bucket.name,
		})
		return
	}
	logger.debug("ensureBucketExists", "bucket doesn't exist, creating it...", {
		bucket: bucket.name,
	})
	await bucket.create()
}

async function bucketExists(bucket: Bucket): Promise<boolean> {
	try {
		const res = await bucket.exists()
		return res[0] === true
	} catch (e) {
		return false
	}
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
		await ensurePageRules(pageRules, ctx)
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

async function ensurePageRules(
	pageRules: CloudflarePageRule[],
	ctx: CloudflareAPIContext,
) {
	logger.debug("ensurePageRules", "ensuring page rules...")
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
			"ensurePageRules",
			"all page rules are already configured and active",
		)
		return
	}
	if (missingRules.length) {
		logger.debug(
			"ensurePageRules",
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
					"ensurePageRules",
					"failed to create page rule",
					{rule, res},
				)
			}
		}
	}
	if (disabledRules.length) {
		logger.debug(
			"ensurePageRules",
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
					"ensurePageRules",
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
