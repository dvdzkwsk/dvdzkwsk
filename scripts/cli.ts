import {
	buildWebsite,
	deployWebsite,
	serveWebsite,
	startWebsite,
} from "./_website"

async function main(rawArgs: string[]) {
	const [cmd, ...args] = rawArgs
	switch (cmd) {
		case "website":
			await website(args)
			break
	}
}

async function website(args: string[]) {
	switch (args[0]) {
		case "build":
			await buildWebsite()
			break
		case "deploy":
			await deployWebsite()
			break
		case "serve":
			await serveWebsite()
			break
		case "start":
			await startWebsite()
			break
	}
}

main(process.argv.slice(2))
