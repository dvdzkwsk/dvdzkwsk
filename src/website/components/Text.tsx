import "./Text.css"
import * as React from "react"
import {cx} from "../../util/ReactUtil.js"

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
	children: React.ReactNode
	muted?: boolean
	className?: string
	headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
	style?: any
	mono?: boolean
	inline?: boolean
}
export const Text = ({
	as,
	children,
	className,
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
		return React.createElement(`h${headingLevel}`, {
			children: children,
			...(typeof children === "string" && {
				id: sluggify(children),
			}),
			...rest,
		})
	}
	props.className = cx("Text", className)
	props.style["--leading"] = 5
	return React.createElement(as || (inline ? "span" : "p"), props, children)
}

export function sluggify(str: string) {
	return str.toLowerCase().replace(/(\s+)/g, "-").replace(/[()]/g, "")
}
