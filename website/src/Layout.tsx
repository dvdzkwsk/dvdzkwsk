import {ComponentChildren} from "preact"

type GapSize = 2 | 4 | 8 | 12 | 16 | 32

export const Flex = ({
	children,
	gap,
}: {
	children: ComponentChildren
	gap?: GapSize
}) => {
	return <div style={{display: "flex", gap}}>{children}</div>
}
