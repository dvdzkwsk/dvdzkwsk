import {ensureGCPInfra} from "./_infra"
import {
	buildWebsite,
	deployWebsite,
	serveWebsite,
	startWebsite,
} from "./_website"

async function main(rawArgs: string[]) {
	const [cmd, ...args] = rawArgs
	try {
		switch (cmd) {
			case "infra":
				await infra(args)
				break
			case "website":
				await website(args)
				break
		}
	} catch (e) {
		console.error(e)
		process.exit(1)
	}
}

async function infra(args: string[]) {
	await ensureGCPInfra()
}

async function website(args: string[]) {
	switch (args[0]) {
		case "build":
			return buildWebsite()
		case "deploy":
			return deployWebsite()
		case "serve":
			return serveWebsite()
		case "start":
			return startWebsite()
	}
}

main(process.argv.slice(2))
