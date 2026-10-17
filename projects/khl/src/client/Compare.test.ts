import {matchValue} from "@dvdzkwsk/util/MatchUtil"
import {describe, expect, test} from "bun:test"
import {getBarFills} from "./Compare.js"

const WIDTH = 10

/**
 * One comparison row as text, the way the card draws it: team A's bar grows
 * left from its value, team B's grows right. A missing bar is blank.
 *
 *     [    ######] 3 | 5 [##########]
 */
function drawRow(a: number | null, b: number | null): string {
	const fills = getBarFills(a, b)
	const bar = (fill: number | null, side: "a" | "b") => {
		if (fill === null) {
			return " ".repeat(WIDTH + 2)
		}
		const filled = "#".repeat(Math.round(fill * WIDTH))
		const empty = " ".repeat(WIDTH - filled.length)
		return `[${matchValue(side, {a: empty + filled, b: filled + empty})}]`
	}
	const show = (value: number | null) => (value === null ? "–" : value)
	return `${bar(fills.a, "a")} ${show(a)} | ${show(b)} ${bar(fills.b, "b")}`
}

describe("getBarFills", () => {
	test("the larger value fills its side, measured from zero", () => {
		expect(drawRow(5, 3)).toBe("[##########] 5 | 3 [######    ]")
		expect(drawRow(2, 8)).toBe("[       ###] 2 | 8 [##########]")
	})

	test("equal values both fill", () => {
		expect(drawRow(4, 4)).toBe("[##########] 4 | 4 [##########]")
	})

	test("a zero is an empty outline", () => {
		expect(drawRow(0, 6)).toBe("[          ] 0 | 6 [##########]")
		expect(drawRow(0, 0)).toBe("[          ] 0 | 0 [          ]")
	})

	describe("with a negative value, the scale starts at the lowest", () => {
		test("positive vs negative", () => {
			expect(drawRow(2, -8)).toBe("[##########] 2 | -8 [          ]")
		})

		test("zero vs negative: zero is ahead, so it fills", () => {
			expect(drawRow(0, -13)).toBe("[##########] 0 | -13 [          ]")
		})

		test("both negative: the less negative fills", () => {
			expect(drawRow(-1, -8)).toBe("[##########] -1 | -8 [          ]")
		})

		test("however close, the better fills and the worse is empty", () => {
			expect(drawRow(-4, 4)).toBe("[          ] -4 | 4 [##########]")
			expect(drawRow(-2, -3)).toBe("[##########] -2 | -3 [          ]")
		})
	})

	test("an unknown value has no bar; the other is scaled alone", () => {
		expect(drawRow(null, 5)).toBe("             – | 5 [##########]")
		expect(drawRow(null, -3)).toBe("             – | -3 [          ]")
		expect(drawRow(null, null)).toBe("             – | –             ")
	})
})
