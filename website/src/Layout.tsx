import {ComponentChildren, JSX} from "preact"
import {useContext} from "preact/hooks"
import {AppContext} from "./App.js"

export const PageLayout = ({children}: {children: ComponentChildren}) => {
	return (
		<div className="PageLayout">
			<header className="PageHeader">
				<nav className="container PageHeader-content">
					<Link href="/" className="PageHeader-title">
						@dvdzkwsk
					</Link>
					<div className="PageHeader-links">
						<Link href="/about">About</Link>
						<Link href="https://github.com/davezuko">GitHub</Link>
					</div>
				</nav>
			</header>
			<main className="PageMain">
				<div className="container PageMain-content">{children}</div>
			</main>
		</div>
	)
}

export const Link = (
	props: JSX.HTMLAttributes<HTMLAnchorElement> & {href: string},
) => {
	const {history} = useContext(AppContext)

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
