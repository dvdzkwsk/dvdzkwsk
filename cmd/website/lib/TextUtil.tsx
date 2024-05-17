import {ComponentChildren, createElement} from "preact"

const FONT_MONO = [
	"ui-monospace",
	"Menlo, Monaco",
	'"Cascadia Mono"',
	'"Segoe UI Mono"',
	'"Roboto Mono"',
	'"Oxygen Mono"',
	'"Ubuntu Monospace"',
	'"Source Code Pro"',
	'"Fira Mono"',
	'"Droid Sans Mono"',
	'"Courier New"',
	"monospace",
].join(",")

interface TextProps {
	as?: any
	children: ComponentChildren
	muted?: boolean
	headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
	style?: any
	mono?: boolean
	inline?: boolean
}
export const Text = ({
	as,
	children,
	muted,
	headingLevel,
	mono,
	inline,
	...rest
}: TextProps) => {
	const props: any = {...rest, style: rest.style ?? {}}
	if (muted) {
		props.style.color = "var(--fg-muted)"
	}
	if (mono) {
		props.style.fontFamily = FONT_MONO
	}
	if (headingLevel) {
		return createElement(`h${headingLevel}`, {
			children: children,
			...(typeof children === "string" && {
				id: sluggify(children),
			}),
			...rest,
		})
	}
	return createElement(as || (inline ? "span" : "p"), props, children)
}

export function sluggify(str: string) {
	return str.toLowerCase().replace(/(\s+)/g, "-").replace(/[()]/g, "")
}
