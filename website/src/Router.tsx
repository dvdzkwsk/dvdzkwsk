import {render, ComponentChildren} from "preact"
import {renderToStaticMarkup} from "preact-render-to-string"
import {useContext, useState, useMemo, useEffect} from "preact/hooks"
import {About} from "./About.js"
import {AppContext} from "./App.js"
import {Home} from "./Home.js"
import {PageLayout} from "./Layout.js"
import {getBlogPosts} from "./blog/index.js"
import {Blog} from "./Blog.js"
import {BlogPost} from "./blog/BlogPostUtil.js"

export function getRoutes(): Route[] {
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
			path: "/blog",
			title: "Blog",
			render: () => <Blog />,
		},
	]
	const posts = getBlogPosts()
	for (const post of posts) {
		routes.push({
			path: `/blog/${post.slug}`,
			title: post.title,
			description: post.description,
			render: () => <BlogPost post={post} />,
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
	const {history} = useContext(AppContext)
	const [, forceUpdate] = useState<any>(null)
	const routes = useMemo(getRoutes, [])
	const currentRoute = routes.find((route) => {
		return history.location.pathname === route.path
	})
	const meta = useMemo(() => {
		return {
			uri: currentRoute?.path.replace(/\/$/, ""),
			title: currentRoute?.title,
			description: currentRoute?.description,
		}
	}, [currentRoute])

	useEffect(() => {
		history.listen(() => forceUpdate({}))
	}, [history])

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
			{meta.title && <meta name="title" content={meta.title} />}
			<meta name="author" content="David Zukowski" />
			{meta.title && <meta property="og:title" content={meta.title} />}
			{meta.description && (
				<meta property="og:description" content={meta.description} />
			)}
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
			<h1>Not Found</h1>
		</PageLayout>
	)
}

export interface Route {
	path: string
	title?: string
	description?: string
	render(): ComponentChildren
}

const BlogPost = ({post}: {post: BlogPost}) => {
	return (
		<PageLayout>
			<h1>{post.title}</h1>
			{post.render()}
		</PageLayout>
	)
}
