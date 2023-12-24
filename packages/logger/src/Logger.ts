import {ACTIVE_TRANSPORTS} from "./LoggerTransport.js"

export type LogLevel = "debug" | "info" | "warn" | "error"

export type LoggerWithLevels = {
	[key in LogLevel]: (
		subcontext: string,
		message: string,
		aux?: LogMessageAux,
	) => void
}

export type Logger = LoggerWithLevels & {
	newError: (
		subcontext: string,
		message: string,
		aux?: LogMessageAux,
	) => Error
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

class LoggerImpl implements Logger {
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

export function newLogger(context: string): Logger {
	return new LoggerImpl(context)
}
