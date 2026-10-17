/** Values that can be matched on: members of a string or number literal union. */
export type MatchKey = string | number

/**
 * Resolves to `never` for wide `string` / `number`, so a call site can't silently lose
 * exhaustiveness by matching on a non-literal type.
 */
export type Exhaustive<T extends MatchKey> = string extends T
	? never
	: number extends T
		? never
		: T

/**
 * The member of `T` that object key `K` names. Numeric literal keys can surface as their
 * string form (`1` as `"1"`), so both spellings map back to the union member.
 */
export type MemberForKey<T extends MatchKey, K> = T extends MatchKey
	? K extends T | `${T}`
		? T
		: never
	: never

/** The variant of tagged union `T` whose `Tag` field is `V`. */
export type Variant<T, Tag extends keyof T, V> = T extends unknown
	? V extends T[Tag]
		? T
		: never
	: never

/** The value of `T[Tag]` that object key `K` names. */
export type TagMember<T, Tag extends keyof T, K> = MemberForKey<
	Extract<T[Tag], MatchKey>,
	K
>
