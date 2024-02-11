import {render, ComponentChildren, JSX} from "preact"
import {renderToStaticMarkup} from "preact-render-to-string"
import {useContext, useState, useMemo, useEffect} from "preact/hooks"
import {About} from "./About.js"
import {AppContext} from "./App.js"
import {Home} from "./Home.js"
import {PageLayout} from "./lib/LayoutUtil.js"
import {BlogPostRenderer} from "./Blog.js"
import {Text} from "./lib/TextUtil.js"
import {Archive} from "./Archive.js"

export interface Route {
	path: string
	title?: string
	description?: string
	render(): ComponentChildren
}

export function getRoutes(context: AppContext): Route[] {
	const routes: Route[] = [
		{
			path: "/",
			title: "Home",
			render: () => <Home />,
		},
		{
			path: "/about",
			title: "About",
			render: () => <About />,
		},
		{
			path: "/archive",
			title: "Archive",
			render: () => <Archive />,
		},
	]
	for (const post of context.posts) {
		routes.push({
			path: post.path,
			title: post.title,
			description: post.description,
			render: () => <BlogPostRenderer post={post} />,
		})
	}
	return routes
}

export interface PageMetadata {
	uri?: string
	title?: string
	description?: string
}

export const CurrentRoute = () => {
	const context = useContext(AppContext)
	const [, forceUpdate] = useState<any>(null)
	const routes = useMemo(() => getRoutes(context), [context])
	const currentRoute = routes.find((route) => {
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
		return <PageNotFound />
	}
	return (
		<>
			<PageMetadata meta={meta} />
			{currentRoute.render()}
		</>
	)
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
			{process.env.WEBSITE_DOMAIN && (
				<meta
					property="og:url"
					content={`https://${process.env.WEBSITE_DOMAIN}${meta.uri}`}
				/>
			)}
			{process.env.WEBSITE_DOMAIN && (
				<link
					rel="canonical"
					href={`https://${process.env.WEBSITE_DOMAIN}${meta.uri}`}
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

const PageNotFound = () => {
	return (
		<PageLayout>
			<Text>Not Found</Text>
		</PageLayout>
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
