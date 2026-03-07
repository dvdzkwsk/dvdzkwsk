export let ACTIVE_TRANSPORTS: LoggerTransport[] = []

export type LogLevel = "debug" | "info" | "warn" | "error"

export type LoggerWithLevels = {
	[key in LogLevel]: (
		subcontext: string,
		message: string,
		aux?: LogMessageAux,
	) => void
}

export interface LogMessage {
	timestamp: Date
	level: LogLevel
	context: string
	subcontext: string
	message: string
	aux: LogMessageAux | null
}

export interface LogMessageAux {
	[key: string]: unknown
}

export class Logger implements LoggerWithLevels {
	context: string

	constructor(context: string) {
		this.context = context
	}

	debug(subcontext: string, message: string, aux?: LogMessageAux) {
		this._logWithLevel("debug", subcontext, message, aux)
	}

	info(subcontext: string, message: string, aux?: LogMessageAux) {
		this._logWithLevel("info", subcontext, message, aux)
	}

	warn(subcontext: string, message: string, aux?: LogMessageAux) {
		this._logWithLevel("warn", subcontext, message, aux)
	}

	error(subcontext: string, message: string, aux?: LogMessageAux) {
		this._logWithLevel("error", subcontext, message, aux)
	}

	newError(subcontext: string, message: string, aux?: LogMessageAux) {
		this._logWithLevel("error", subcontext, message, aux)
		return new Error(message)
	}

	private _logWithLevel(
		level: LogLevel,
		subcontext: string,
		message: string,
		aux?: LogMessageAux,
	) {
		const logMessage: LogMessage = {
			timestamp: new Date(),
			level,
			context: this.context,
			subcontext,
			message,
			aux: aux ?? null,
		}
		for (const transport of ACTIVE_TRANSPORTS) {
			transport.log(logMessage)
		}
	}
}

export interface LoggerTransport {
	log(message: LogMessage): void
}

export function setLoggerTransports(transports: LoggerTransport[]) {
	ACTIVE_TRANSPORTS = transports
}

export interface ConsoleTransportOptions {
	verbose: boolean
}
export class ConsoleTransport implements LoggerTransport {
	constructor(public options: ConsoleTransportOptions) {}

	log(message: LogMessage) {
		const formatted = `[${message.context}.${message.subcontext}] ${message.message}`
		if (message.aux && this.options.verbose) {
			console[message.level](formatted, message.aux)
		} else {
			console[message.level](formatted)
		}
	}
}
