import {describe, expect, test} from "bun:test"
import {matchField, matchFn, matchValue} from "./MatchUtil.js"

type Status = "active" | "paused" | "archived"
type Level = 1 | 2 | 3

type State =
	| {status: "loading"}
	| {status: "error"; error: string}
	| {status: "success"; data: number[]}

/**
 * Returns `value` typed as the wider `T`, so a test can hand the helpers a union rather
 * than the literal TypeScript would narrow a `const` to.
 */
function widen<T>(value: T): T {
	return value
}

describe("matchFn", () => {
	test("calls the handler for the value and returns its result", () => {
		const label = (status: Status) =>
			matchFn(status, {
				active: () => "Active",
				paused: () => "Paused",
				archived: () => "Archived",
			})
		expect(label("active")).toBe("Active")
		expect(label("paused")).toBe("Paused")
		expect(label("archived")).toBe("Archived")
	})

	test("passes the handler the value narrowed to its key", () => {
		const result = matchFn(widen<Status>("paused"), {
			active: (s: "active") => s,
			paused: (s: "paused") => s,
			archived: (s: "archived") => s,
		})
		expect(result).toBe("paused")
	})

	test("matches numeric literal unions", () => {
		const name = (level: Level) =>
			matchFn(level, {1: () => "one", 2: () => "two", 3: () => "three"})
		expect(name(1)).toBe("one")
		expect(name(3)).toBe("three")
	})

	test("throws when no handler exists for the value at runtime", () => {
		const value = "deleted" as unknown as Status
		expect(() =>
			matchFn(value, {
				active: () => 1,
				paused: () => 2,
				archived: () => 3,
			}),
		).toThrow("no handler for value")
	})

	test("does not treat inherited properties as handlers", () => {
		const value = "toString" as unknown as Status
		expect(() =>
			matchFn(value, {
				active: () => 1,
				paused: () => 2,
				archived: () => 3,
			}),
		).toThrow("no handler for value")
	})

	test("rejects missing, extra, and wide cases at the type level", () => {
		const status = widen<Status>("active")
		// @ts-expect-error missing "archived"
		matchFn(status, {active: () => 1, paused: () => 2})
		matchFn(status, {
			active: () => 1,
			paused: () => 2,
			archived: () => 3,
			// @ts-expect-error "deleted" isn't a member of Status
			deleted: () => 4,
		})
		// @ts-expect-error a wide string has no exhaustive set of cases
		matchFn(widen<string>("active"), {active: () => 1})
	})
})

describe("matchValue", () => {
	test("returns the entry for the value", () => {
		const color = (status: Status) =>
			matchValue(status, {
				active: "green",
				paused: "yellow",
				archived: "gray",
			})
		expect(color("active")).toBe("green")
		expect(color("archived")).toBe("gray")
	})

	test("returns falsy entries as-is", () => {
		const count = (level: Level) =>
			matchValue(level, {1: 0, 2: null, 3: ""})
		expect(count(1)).toBe(0)
		expect(count(2)).toBeNull()
		expect(count(3)).toBe("")
	})

	test("throws when no entry exists for the value at runtime", () => {
		const value = 4 as unknown as Level
		expect(() => matchValue(value, {1: "a", 2: "b", 3: "c"})).toThrow(
			"no entry for value",
		)
	})

	test("rejects missing, extra, and wide cases at the type level", () => {
		const level = widen<Level>(1)
		// @ts-expect-error missing 3
		matchValue(level, {1: "a", 2: "b"})
		// @ts-expect-error 4 isn't a member of Level
		matchValue(level, {1: "a", 2: "b", 3: "c", 4: "d"})
		// @ts-expect-error a wide number has no exhaustive set of cases
		matchValue(widen<number>(1), {1: "a"})
	})
})

describe("matchField", () => {
	test("passes the handler the object narrowed to its variant", () => {
		const total = (state: State) =>
			matchField(state, "status", {
				loading: () => null,
				error: (s) => s.error,
				success: (s) => s.data.reduce((sum, n) => sum + n, 0),
			})
		expect(total({status: "loading"})).toBeNull()
		expect(total({status: "error", error: "boom"})).toBe("boom")
		expect(total({status: "success", data: [1, 2, 3]})).toBe(6)
	})

	test("passes the handler the same object it was given", () => {
		const state = widen<State>({status: "success", data: [1]})
		const received = matchField(state, "status", {
			loading: (s) => s,
			error: (s) => s,
			success: (s) => s,
		})
		expect(received).toBe(state)
	})

	test("matches on any tag field, including numeric ones", () => {
		type Shape = {sides: 3; base: number} | {sides: 4; width: number}
		const describeShape = (shape: Shape) =>
			matchField(shape, "sides", {
				3: (s) => `triangle ${s.base}`,
				4: (s) => `square ${s.width}`,
			})
		expect(describeShape({sides: 3, base: 2})).toBe("triangle 2")
		expect(describeShape({sides: 4, width: 5})).toBe("square 5")
	})

	test("throws when no handler exists for the tag value at runtime", () => {
		const state = {status: "idle"} as unknown as State
		expect(() =>
			matchField(state, "status", {
				loading: () => 1,
				error: () => 2,
				success: () => 3,
			}),
		).toThrow("no handler for tag value")
	})

	test("rejects missing, extra, and wide cases at the type level", () => {
		const state = widen<State>({status: "loading"})
		// @ts-expect-error missing "success"
		matchField(state, "status", {loading: () => 1, error: () => 2})
		matchField(state, "status", {
			loading: () => 1,
			error: () => 2,
			success: () => 3,
			// @ts-expect-error "idle" isn't a status
			idle: () => 4,
		})
		matchField(state, "status", {
			loading: () => 1,
			// @ts-expect-error the error variant has no data
			error: (s) => s.data,
			success: () => 3,
		})
		const loose = widen<{kind: string}>({kind: "a"})
		// @ts-expect-error a wide string tag has no exhaustive set of cases
		matchField(loose, "kind", {a: () => 1})
	})
})
