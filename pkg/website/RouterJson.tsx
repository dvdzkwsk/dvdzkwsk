import * as React from "react"
import {AppContext} from "./App.js"

export interface PageSchema {
	title: string
	description?: string
	layout: React.FC<{children: React.ReactElement}>
	content: React.FC
}
export function definePage(page: PageSchema): PageSchema {
	return page
}

type LinkProps = React.HTMLAttributes<HTMLAnchorElement> & {href: string}

export const Link = (props: LinkProps) => {
	const {history} = React.useContext(AppContext)

	if (typeof props.href === "string" && props.href.startsWith("http")) {
		return <a {...props} rel="noopener noreferrer" target="_blank" />
	}
	return (
		<a
			{...props}
			onClick={(e) => {
				if (!e.ctrlKey && !e.metaKey) {
					e.preventDefault()
					history.push(props.href)
				}
			}}
		/>
	)
}
