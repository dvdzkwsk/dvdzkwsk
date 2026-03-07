export function cx(
	...classes: (string | undefined | null | boolean)[]
): string {
	return classes.filter((c) => !!c).join(" ")
}
