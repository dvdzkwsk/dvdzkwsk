import {ComponentChildren, createElement} from "preact"

interface TextProps {
	children: ComponentChildren
	muted?: boolean
	headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
	style?: any
}
export const Text = ({children, muted, headingLevel, ...rest}: TextProps) => {
	const props: any = {...rest, style: rest.style ?? {}}
	if (muted) {
		props.style.color = "var(--fg-muted)"
	}
	if (headingLevel) {
		return createElement(`h${headingLevel}`, {
			children: children,
			...rest,
		})
	}
	return <p {...rest}>{children}</p>
}

export function sluggify(title: string) {
	return title.toLowerCase().replace(/(\s+)/g, "-").replace(/[()]/g, "")
}
