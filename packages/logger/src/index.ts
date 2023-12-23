import * as fs from "fs"
import * as path from "path"

export interface LogMessage {
	level: LogLevel
	context: string
	subcontext: string
	message: string
	aux: LogAux | null
}

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogAux {
	[key: string]: unknown
}

interface LoggerTransport {
	log(message: LogMessage): void
}

const TRANSPORTS: LoggerTransport[] = [
	createConsoleTransport(),
	createFileTransport(),
]

class Logger {
	context: string

	constructor(context: string) {
		this.context = context
	}

	logWithLevel(
		level: LogLevel,
		subcontext: string,
		message: string,
		aux?: LogAux,
	) {
		const logMessage: LogMessage = {
			level,
			context: this.context,
			subcontext,
			message,
			aux: aux ?? null,
		}
		for (const transport of TRANSPORTS) {
			transport.log(logMessage)
		}
	}

	debug(subcontext: string, message: string, aux?: LogAux) {
		this.logWithLevel("debug", subcontext, message, aux)
	}

	info(subcontext: string, message: string, aux?: LogAux) {
		this.logWithLevel("info", subcontext, message, aux)
	}

	warn(subcontext: string, message: string, aux?: LogAux) {
		this.logWithLevel("warn", subcontext, message, aux)
	}

	error(subcontext: string, message: string, aux?: LogAux) {
		this.logWithLevel("error", subcontext, message, aux)
	}
}

export function createLogger(context: string): Logger {
	return new Logger(context)
}

function createConsoleTransport(): LoggerTransport {
	return {
		log(message) {
			if (message.aux) {
				console[message.level](
					`[${message.context}:${message.subcontext}] ${message.message}`,
					message.aux,
				)
			} else {
				console[message.level](
					`[${message.context}:${message.subcontext}] ${message.message}`,
				)
			}
		},
	}
}

function createFileTransport(): LoggerTransport {
	const date = new Date()
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, "0") // Months are zero-based
	const day = String(date.getDate()).padStart(2, "0")
	const hh = String(date.getHours()).padStart(2, "0")
	const mm = String(date.getMinutes()).padStart(2, "0")
	const ss = String(date.getSeconds()).padStart(2, "0")
	const timestamp = `${year}-${month}-${day}-${hh}-${mm}-${ss}`

	fs.mkdirSync(".logs", {recursive: true})

	const jsonName = path.join(process.cwd(), ".logs", `${timestamp}.json`)
	const jsonStream = fs.createWriteStream(jsonName)
	const jsonLatest = ".logs/latest.json"
	fs.rmSync(jsonLatest, {force: true})
	fs.symlinkSync(jsonName, jsonLatest)

	const textName = path.join(process.cwd(), ".logs", `${timestamp}.txt`)
	const textStream = fs.createWriteStream(textName)
	const textLatest = ".logs/latest.txt"
	fs.rmSync(textLatest, {force: true})
	fs.symlinkSync(textName, textLatest)

	jsonStream.write("[")
	process.on("exit", () => {
		jsonStream.write("\n]\n")
		jsonStream.end()
		textStream.end()
	})

	let isFirstMessage = true
	return {
		log(message) {
			if (isFirstMessage) {
				isFirstMessage = false
				jsonStream.write("\n\t" + JSON.stringify(message))
			} else {
				jsonStream.write(",\n\t" + JSON.stringify(message))
			}
			textStream.write(formatLogMessage(message) + "\n")
		},
	}
}

function formatLogMessage(message: LogMessage): string {
	let formatted = `[${message.context}:${message.subcontext}] ${message.message}`
	if (message.aux) {
		formatted += ` (aux: ${JSON.stringify(message.aux)})`
	}
	return formatted
}
