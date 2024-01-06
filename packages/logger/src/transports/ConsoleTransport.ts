import {LoggerTransport} from "../LoggerTransport.js"

export interface ConsoleTransportOptions {
	verbose: boolean
}
export function newConsoleTransport(
	options: ConsoleTransportOptions,
): LoggerTransport {
	return {
		log(message) {
			const formatted = `[${message.context}.${message.subcontext}] ${message.message}`
			if (message.aux && options.verbose) {
				console[message.level](formatted, message.aux)
			} else {
				console[message.level](formatted)
			}
		},
	}
}
