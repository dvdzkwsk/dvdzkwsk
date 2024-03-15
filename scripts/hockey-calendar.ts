async function main() {
	const options: LoadCalendarOptions = {
		startDate: new Date(),
		endDate: new Date(),
	}
	options.endDate.setDate(options.endDate.getDate() + 30)

	const calendar = await loadCalendar(options)
	if (calendar.error) {
		console.error("response error: %s", calendar.error)
		process.exit(1)
	}
	for (const event of calendar.data) {
		console.log(
			"%s: %s",
			new Date(event.start).toLocaleString(),
			event.title,
		)
	}
}

interface LoadCalendarOptions {
	startDate: Date
	endDate: Date
}
interface LoadCalendarResult {
	response: Response
	error: Error | null
	data: CalendarEvent[]
}

interface CalendarEvent {
	url: string
	title: string
	start: string
	end: string
	sportId: number
	color: string
}

async function loadCalendar(
	options: LoadCalendarOptions,
): Promise<LoadCalendarResult> {
	const start = options.startDate.toISOString()
	const end = options.endDate.toISOString()
	const url = `https://www.krakencommunityiceplex.com/Umbraco/api/DaySmartCalendarApi/GetEventsAsync?start=${start}&end=${end}&variant=2`
	const response = await fetch(url)
	const result: LoadCalendarResult = {
		error: null,
		response,
		data: [],
	}
	if (isOkResponse(response)) {
		result.data = await response.json()
	} else {
		result.error = new Error(`bad response status: ${response.status}`)
	}
	return result
}

function isOkResponse(response: Response): boolean {
	return response.status >= 200 && response.status <= 299
}

main()
