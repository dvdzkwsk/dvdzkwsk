import "./DefaultLayout.css"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {AppContext} from "../App.js"
import {Link} from "../RouterJson.js"

const NAV_ITEMS = [
	{href: "/", label: "About"},
	{href: "/projects", label: "Projects"},
]

interface DefaultLayoutProps {
	children: React.ReactElement
}
export const DefaultLayout: React.FC<DefaultLayoutProps> = ({children}) => {
	return (
		<div className="DefaultLayout">
			<aside className="DefaultLayout-aside">
				<div className="DefaultLayout-asideInner">
					<div className="DefaultLayout-brand">
						<Link href="/" className="DefaultLayout-logo">
							<Logo />
						</Link>
						<SiteName className="DefaultLayout-siteName--mobile" />
					</div>
					<Nav />
				</div>
			</aside>
			<main className="DefaultLayout-main">
				<SiteName className="DefaultLayout-siteName--desktop" />
				<div className="DefaultLayout-content">
					<div className="DefaultLayout-prose">{children}</div>
				</div>
				<Footer />
			</main>
		</div>
	)
}

const SiteName = ({className}: {className: string}) => {
	return (
		<h1 className={cx("DefaultLayout-siteName", className)}>
			<Link href="/">David Zukowski</Link>
		</h1>
	)
}

const Nav = () => {
	const {history} = React.useContext(AppContext)
	const pathname = history.location.pathname.replace(/(.)\/$/, "$1")
	return (
		<nav className="DefaultLayout-nav">
			{NAV_ITEMS.map((item) => {
				const active = item.href === pathname
				return (
					<div key={item.href} className="DefaultLayout-navItem">
						<div
							className={cx(
								"DefaultLayout-navDot",
								active && "DefaultLayout-navDot--active",
							)}
						/>
						<Link
							href={item.href}
							className={cx(
								"DefaultLayout-navLink",
								active && "DefaultLayout-navLink--active",
							)}
						>
							{item.label}
						</Link>
					</div>
				)
			})}
		</nav>
	)
}

const Footer = () => {
	return (
		<footer className="DefaultLayout-footer">
			<div>© {new Date().getFullYear()} David Zukowski.</div>
			<div className="DefaultLayout-footerLinks">
				<Link href="https://github.com/dvdzkwsk" aria-label="GitHub">
					<svg viewBox="0 0 24 24" className="DefaultLayout-footerIcon">
						<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
					</svg>
				</Link>
			</div>
		</footer>
	)
}

const Logo = () => {
	return (
		<span className="DefaultLayout-logoMark" aria-label="Home">
			dz<span className="DefaultLayout-logoDot">.</span>
		</span>
	)
}
