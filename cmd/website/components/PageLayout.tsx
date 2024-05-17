import "./PageLayout.css"
import {ComponentChildren} from "preact"
import {Link} from "../Router.js"

export const PageLayout = ({children}: {children: ComponentChildren}) => {
	return (
		<div className="PageLayout">
			<header className="PageHeader">
				<div className="container">
					<nav className="PageHeader-content">
						<Link href="/" className="PageHeader-title">
							@dvdzkwsk
						</Link>
						<div className="PageHeader-links">
							<Link href="/about">About</Link>
							<Link href="/archive">Archive</Link>
							<Link href="https://github.com/dvdzkwsk">
								GitHub
							</Link>
						</div>
					</nav>
				</div>
			</header>
			<main className="PageMain">
				<div className="container PageMain-content">{children}</div>
			</main>
		</div>
	)
}
