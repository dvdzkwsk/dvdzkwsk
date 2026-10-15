import "./DefaultLayout.css"
import * as React from "react"

interface DefaultLayoutProps {
	children: React.ReactElement
}
export const DefaultLayout: React.FC<DefaultLayoutProps> = ({children}) => {
	return (
		<div className="DefaultLayout">
			<main className="DefaultLayout-content">{children}</main>
		</div>
	)
}
