import {getInfraCommand} from "./commands/infra"
import {getWebsiteCommand} from "./commands/website"

export interface Command {
	name: string
	run?(args: string[]): void
	commands?: Command[]
}

const commands: Command[] = [getInfraCommand(), getWebsiteCommand()]

async function main(rawArgs: string[]) {
	const [cmdName, ...args] = rawArgs
	try {
		for (const cmd of commands) {
			if (cmd.name === cmdName) {
				const [subCmdName, ...subCmdArgs] = args
				const subCommands = cmd.commands ?? []
				for (const subCmd of subCommands) {
					if (subCmd.name === subCmdName) {
						await subCmd.run?.(subCmdArgs)
						return
					}
				}
				throw new Error(
					`Unknown '${cmdName}' subcommand: ${subCmdName}`,
				)
			}
		}
		throw new Error(`Unknown command: ${cmdName}`)
	} catch (e) {
		console.error(e)
		process.exit(1)
	}
}

main(process.argv.slice(2))
