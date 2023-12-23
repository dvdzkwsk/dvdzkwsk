import {LogMessage} from "./Logger.js"

export let ACTIVE_TRANSPORTS: LoggerTransport[] = []

export interface LoggerTransport {
	log(message: LogMessage): void
}

export function setLoggerTransports(transports: LoggerTransport[]) {
	ACTIVE_TRANSPORTS = transports
}
