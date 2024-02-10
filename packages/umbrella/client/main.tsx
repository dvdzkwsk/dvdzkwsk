import {render} from "preact"
import {ConsoleTransport, setLoggerTransports} from "@dvdzkwsk/logger"
import {App, createAppContext} from "./App.js"
import {configureSupabase} from "./Supabase.js"

async function main() {
	setLoggerTransports([new ConsoleTransport({verbose: true})])
	configureSupabase()

	const context = createAppContext()

	render(<App context={context} />, document.getElementById("root")!)
}

main()
