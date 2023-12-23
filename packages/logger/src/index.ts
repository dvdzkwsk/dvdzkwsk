export {newLogger, type Logger} from "./Logger.js"
export {
	type LoggerTransport,
	setLoggerTransports as configureTransports,
} from "./LoggerTransport.js"
export {newConsoleTransport} from "./transports/ConsoleTransport.js"
export {newFileTransport} from "./transports/FileTransport.js"
