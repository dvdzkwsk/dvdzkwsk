import {ComponentChildren, JSX} from "preact"

export const PageLayout = ({children}: {children: ComponentChildren}) => {
	return (
		<div className="PageLayout">
			<header className="PageHeader">
				<nav className="container PageHeader-content">
					<a href="/" className="PageHeader-title">
						David Zukowski
					</a>
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

export const Link = (props: JSX.HTMLAttributes<HTMLAnchorElement>) => {
	if (typeof props.href === "string" && props.href.startsWith("http")) {
		return <a {...props} rel="noopener noreferrer" target="_blank" />
	}
	return <a {...props} />
}
