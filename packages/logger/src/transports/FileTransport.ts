import * as fs from "fs"
import * as path from "path"
import {LogMessage} from "../Logger.js"
import {LoggerTransport} from "../LoggerTransport.js"

export function newFileTransport(): LoggerTransport {
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
	let formatted = `[${message.timestamp.toLocaleString("en-us", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		fractionalSecondDigits: 3,
	})}] [${message.context}:${message.subcontext}] ${message.message}`
	if (message.aux) {
		formatted += ` (aux: ${JSON.stringify(message.aux)})`
	}
	return formatted
}
