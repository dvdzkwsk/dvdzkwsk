import express from "express"
import compression from "compression"

async function main() {
	const app = express()
	app.use(compression())
	app.use(express.static("dist/website"))
	app.listen(8080, () => {
		console.log("serving website at http://localhost:8080")
	})
}

main()
