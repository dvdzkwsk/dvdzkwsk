import {ComponentChildren, createElement} from "preact"

type GapSize = 2 | 4 | 8 | 12 | 16 | 32

type HTMLElementTagName = keyof HTMLElementTagNameMap

type HTMLElementAttributes<T extends HTMLElementTagName> =
	createElement.JSX.HTMLAttributes<HTMLElementTagNameMap[T]>

type CSSProperties = createElement.JSX.CSSProperties

interface BoxProps<T extends HTMLElementTagName = "div">
	extends HTMLElementAttributes<T>,
		FlexProps {
	as?: T
	children?: ComponentChildren
}

interface FlexProps {
	gap?: GapSize
	flex?: boolean
}

export const Box = <T extends HTMLElementTagName>(props: BoxProps<T>) => {
	const {style, other} = useBoxStyles(props)
	return createElement((props.as || "div") as any, {
		...other,
		style,
	})
}

export function useBoxStyles<T extends HTMLElementTagName>(
	props: BoxProps<T>,
): {
	style: CSSProperties
	other: HTMLElementAttributes<T>
} {
	const style: CSSProperties = {}
	const other: HTMLElementAttributes<T> = {}
	for (const key in props) {
		switch (key) {
			case "flex":
				style.display = "flex"
				break
			case "gap":
				style.gap = props.gap
				break
			default:
				// @ts-expect-error
				other[key] = props[key]
		}
	}
	return {style, other}
}
