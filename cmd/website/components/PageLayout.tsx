import "./PageLayout.css"
import {ComponentChildren} from "preact"
import {Link} from "../Router.js"

export const PageLayout = ({children}: {children: ComponentChildren}) => {
	return (
		<div className="PageLayout">
			<main className="PageLayout-content">{children}</main>
		</div>
	)
}
