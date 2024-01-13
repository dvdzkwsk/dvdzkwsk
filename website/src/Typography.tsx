import {ComponentChildren, createElement} from "preact"

interface TextProps {
	children: ComponentChildren
	headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
}
export const Text = (props: TextProps) => {
	if (props.headingLevel) {
		return createElement(`h${props.headingLevel}`, {
			children: props.children,
			...(typeof props.children === "string" && {
				id: sluggify(props.children),
			}),
		})
	}
	return <p>{props.children}</p>
}

export function sluggify(title: string) {
	return title.toLowerCase().replace(/(\s+)/g, "-").replace(/[()]/g, "")
}
