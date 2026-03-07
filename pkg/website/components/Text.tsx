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

type Style = React.CSSProperties & Record<string, unknown>

interface TextProps {
	as?: React.ElementType
	children: React.ReactNode
	muted?: boolean
	className?: string
	headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
	style?: React.CSSProperties
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
	style: styleProp,
}: TextProps) => {
	if (headingLevel) {
		return React.createElement(`h${headingLevel}`, {
			children,
			...(typeof children === "string" && {id: sluggify(children)}),
			style: styleProp,
		})
	}
	const style: Style = {...(styleProp ?? {})}
	if (muted) {
		style.color = "var(--fg-muted)"
	}
	if (mono) {
		style.fontFamily = FONT_MONO
	}
	style["--leading"] = 5
	return React.createElement(
		as || (inline ? "span" : "p"),
		{className: cx("Text", className), style},
		children,
	)
}

export function sluggify(str: string) {
	return str.toLowerCase().replace(/(\s+)/g, "-").replace(/[()]/g, "")
}
