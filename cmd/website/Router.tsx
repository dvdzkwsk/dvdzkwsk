import {render, ComponentChildren, JSX} from "preact"
import {renderToStaticMarkup} from "preact-render-to-string"
import {useContext, useState, useMemo, useEffect} from "preact/hooks"
import {AppContext} from "./App.js"
import {Home} from "./pages/Home.js"
import {NotFound} from "./pages/NotFound.js"

const WEBSITE_DOMAIN = "dvdzkwsk.com"

export interface Route {
	path: string
	title?: string
	description?: string
	render(): ComponentChildren
}
export const ROUTES: Route[] = [
	{
		path: "/",
		title: "Home",
		render: () => <Home />,
	},
]

export const CurrentRoute = () => {
	const context = useContext(AppContext)
	const [, forceUpdate] = useState<any>(null)
	const currentRoute = ROUTES.find((route) => {
		return context.history.location.pathname === route.path
	})
	const meta = useMemo(() => {
		return {
			uri: currentRoute?.path.replace(/\/$/, ""),
			title: currentRoute?.title,
			description: currentRoute?.description,
		}
	}, [currentRoute])

	useEffect(() => {
		return context.history.listen(() => forceUpdate({}))
	}, [context.history])

	if (!currentRoute) {
		return <NotFound />
	}
	return (
		<>
			<PageMetadata meta={meta} />
			{currentRoute.render()}
		</>
	)
}

export interface PageMetadata {
	uri?: string
	title?: string
	description?: string
}
const PageMetadata = ({meta}: {meta: PageMetadata}) => {
	const appContext = useContext(AppContext)
	appContext.meta = meta

	const elem = (
		<>
			{meta.title && (
				<title>
					{meta.title === "Home"
						? "David Zukowski"
						: meta.title + " | David Zukowski"}
				</title>
			)}
			{meta.title && <meta name="title" content={meta.title} />}
			{meta.title && <meta property="og:title" content={meta.title} />}
			<meta name="author" content="David Zukowski" />
			{meta.description && (
				<meta property="og:description" content={meta.description} />
			)}
			<meta property="og:site_name" content="David Zukowski" />
			{WEBSITE_DOMAIN && (
				<meta
					property="og:url"
					content={`https://${WEBSITE_DOMAIN}${meta.uri}`}
				/>
			)}
			{WEBSITE_DOMAIN && (
				<link
					rel="canonical"
					href={`https://${WEBSITE_DOMAIN}${meta.uri}`}
				/>
			)}
		</>
	)
	if (process.env.SSR) {
		appContext.metaHtml = renderToStaticMarkup(elem)
		return null
	}

	useEffect(() => {
		// TODO: infer this from what's rendered inside elem
		document.head.querySelector("title")?.remove()
		document.head.querySelector('link[rel="canonical"]')?.remove()
		document.head.querySelector('meta[name="title"]')?.remove()
		document.head.querySelector('meta[name="author"]')?.remove()
		document.head.querySelector('meta[property="og:title"]')?.remove()
		document.head.querySelector('meta[property="og:description"]')?.remove()
		document.head.querySelector('meta[property="og:url"]')?.remove()

		const container = document.createElement("meta")
		document.head.appendChild(container)
		render(elem, document.head, container)
	}, [meta])

	return null
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
