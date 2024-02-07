import {LogMessage} from "./Logger.js"

export let ACTIVE_TRANSPORTS: LoggerTransport[] = []

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
