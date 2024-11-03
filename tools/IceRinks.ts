import url from "url"
import {endOfDay, startOfDay, subDays} from "date-fns"
import {mapAsync} from "@pkg/async/AsyncUtil.js"

async function main() {
	const rinks = [LYNNWOOD_ICE_CENTER]

	const today = new Date()
	const options: GetCalendarOptions = {
		startDate: startOfDay(subDays(today, 7)),
		endDate: endOfDay(today),
	}
	await mapAsync(
		rinks,
		async (rink) => {
			await rink.getCalendar(options)
		},
		{concurrency: 5},
	)
}

interface GetCalendarOptions {
	startDate: Date
	endDate: Date
}
const LYNNWOOD_ICE_CENTER = {
	name: "Lynnwood Ice Center",
	async getCalendar(options: GetCalendarOptions) {
		const u = new url.URL("https://www.rectimes.app/ova/booking/getbooking")
		u.searchParams.set("rink", "1146")
		u.searchParams.set("multiview", "0")
		u.searchParams.set("start", options.startDate.toISOString())
		u.searchParams.set("end", options.endDate.toISOString())

		const response = await Bun.fetch(u.toString(), {
			headers: {
				accept: "application/json, text/javascript, */*; q=0.01",
				"accept-language": "en-US,en;q=0.8",
			},
		})
		const items: GetBookingResponseItem[] = await response.json()
	},
}

interface GetBookingResponseItem {
	CPCPaidUnpaid: string
	agreementBatchId: unknown
	agreementNumber: unknown
	agreemented: unknown
	allDay: boolean
	bPadding: string
	batchId: string
	bookingType: string
	bookingUsers: {
		groupId: string
		groupName: string
		isPaid: false
		eventName: string
	}[]
	checkImage: string
	color: string
	customField1: string
	customField2: string
	customField3: string
	customField4: null
	description: string
	editable: true
	encryptedGroupId: string
	end: string
	eventName: string
	eventType: string
	feed: string
	groupId: string
	groupId4: null
	id: string
	invoiceBatchId: null
	invoiceNumber: null
	invoiced: 0
	isMargin: null
	isMultiUser: string
	isPaid: string
	isPaidG1: string
	isPaidG2: string
	isPaidG3: string
	isPaidG4: string
	isRepeat: string
	note: string
	paymentMethod: string
	referenceId: string
	resourceId: string
	start: string
	title: string
	totalCost: string
	updated: false
}
main()
