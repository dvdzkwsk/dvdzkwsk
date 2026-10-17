import type {
	Exhaustive,
	MatchKey,
	MemberForKey,
	TagMember,
	Variant,
} from "./TypeUtil.js"
import {Logger} from "../logger/Logger.js"

const logger = new Logger("MatchUtil")

/**
 * Exhaustive match that invokes the handler for `value` and returns its result. Every
 * member of `T` needs a handler, and keys that aren't members of `T` are rejected, so
 * growing or shrinking the union fails the typecheck at every call site instead of
 * falling through at runtime. Each handler receives `value` narrowed to its own key.
 *
 *     const label = matchFn(status, {
 *         active: () => "Active",
 *         paused: () => "Paused",
 *         archived: (s) => formatArchived(s),
 *     })
 */
export function matchFn<T extends MatchKey, R extends {[K in T]: unknown}>(
	value: T & Exhaustive<T>,
	handlers: {
		[K in keyof R]: [MemberForKey<NoInfer<T>, K>] extends [never]
			? never
			: (value: MemberForKey<NoInfer<T>, K>) => R[K]
	},
): R[T] {
	if (!Object.hasOwn(handlers, value)) {
		throw logger.newError("matchFn", "no handler for value", {
			value,
			handlers: Object.keys(handlers),
		})
	}
	const handler = handlers[value as keyof R] as unknown as (value: T) => R[T]
	return handler(value)
}

/**
 * Exhaustive lookup that returns the entry for `value`. Same guarantees as `matchFn`, for
 * when each case is a plain value rather than a computation.
 *
 *     const color = matchValue(status, {
 *         active: "green",
 *         paused: "yellow",
 *         archived: "gray",
 *     })
 */
export function matchValue<T extends MatchKey, M extends {[K in T]: unknown}>(
	value: T & Exhaustive<T>,
	map: {
		[K in keyof M]: [MemberForKey<NoInfer<T>, K>] extends [never]
			? never
			: M[K]
	},
): M[T] {
	if (!Object.hasOwn(map, value)) {
		throw logger.newError("matchValue", "no entry for value", {
			value,
			keys: Object.keys(map),
		})
	}
	return map[value as keyof M] as M[T]
}

/**
 * Exhaustive match on a tagged union: picks the handler for `obj[tag]` and passes it `obj`
 * narrowed to that variant, so each case can read the variant's own fields. Same
 * guarantees as `matchFn` for the tag's values.
 *
 *     const data = matchField(state, "status", {
 *         loading: () => null,
 *         error: () => null,
 *         success: (s) => s.data,
 *     })
 */
export function matchField<
	T extends object,
	Tag extends keyof T,
	R extends {[K in Extract<T[Tag], MatchKey>]: unknown},
>(
	obj: T,
	tag: Tag & (T[Tag] extends Exhaustive<T[Tag] & MatchKey> ? unknown : never),
	handlers: {
		[K in keyof R]: [TagMember<T, Tag, K>] extends [never]
			? never
			: (value: NoInfer<Variant<T, Tag, TagMember<T, Tag, K>>>) => R[K]
	},
): R[Extract<T[Tag], MatchKey>] {
	const value = obj[tag] as MatchKey
	if (!Object.hasOwn(handlers, value)) {
		throw logger.newError("matchField", "no handler for tag value", {
			tag: String(tag),
			value,
			handlers: Object.keys(handlers),
		})
	}
	const handler = handlers[value as keyof R] as unknown as (
		value: T,
	) => R[Extract<T[Tag], MatchKey>]
	return handler(obj)
}
