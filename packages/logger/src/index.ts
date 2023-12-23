export interface LogMessage {
	level: LogLevel
	context: string
	subcontext: string
	message: string
	aux: LogAux | null
}

export type LogLevel = "debug" | "warn" | "error"

export interface LogAux {
	[key: string]: unknown
}

class Logger {
	context: string

	constructor(context: string) {
		this.context = context
	}

	log(level: LogLevel, subcontext: string, message: string, aux?: LogAux) {
		const logMessage: LogMessage = {
			level,
			context: this.context,
			subcontext,
			message,
			aux: aux ?? null,
		}
		if (logMessage.aux) {
			console[logMessage.level](
				`[${logMessage.context}:${logMessage.subcontext}] ${logMessage.message}`,
				logMessage.aux,
			)
		} else {
			console[logMessage.level](
				`[${logMessage.context}:${logMessage.subcontext}] ${logMessage.message}`,
			)
		}
	}
}

export function createLogger(context: string): Logger {
	return new Logger(context)
}
