export function parseDateString(isoString: string): Date {
	const [year, month, day] = isoString.split("-") as any
	return new Date(year, month - 1, day)
}

export function formatDate(date: Date) {
	const yyyy = date.getFullYear()
	const mm = (date.getMonth() + 1).toString().padStart(2, "0")
	const dd = date.getDate().toString().padStart(2, "0")
	return `${yyyy}-${mm}-${dd}`
}
