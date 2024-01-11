import {History} from "history"
import {ComponentChildren, createContext} from "preact"
import {useContext, useEffect, useMemo} from "preact/hooks"
import {getBlogPosts} from "./blog/index.js"
import {PageLayout} from "./Layout.js"
import {About} from "./About.js"
import {Home} from "./Home.js"
import {BlogPost} from "./blog/BlogPostUtil.js"

interface AppContext {
	history: History
	meta: {
		uri?: string
		title?: string
		description?: string
	}
}
const AppContext = createContext<AppContext>(null!)

export function createAppContext(history: History) {
	return {
		history,
		meta: {},
	}
}

export const App = ({context}: {context: AppContext}) => {
	return (
		<AppContext.Provider value={context}>
			<CurrentRoute />
		</AppContext.Provider>
	)
}

const CurrentRoute = () => {
	const appContext = useContext(AppContext)
	const routes = useMemo(getRoutes, [])
	const currentRoute = routes.find((route) => {
		return appContext.history.location.pathname === route.path
	})
	appContext.meta = {
		uri: currentRoute?.path.replace(/\/$/, ""),
		title: currentRoute?.title,
		description: currentRoute?.description,
	}
	useEffect(() => {
		if (process.env.SSR) return

		document.head.querySelector('link[rel="canonical"]')?.remove()

		if (currentRoute && process.env.WEBSITE_DOMAIN) {
			const canonical = document.createElement("link")
			canonical.setAttribute("rel", "canonical")
			canonical.setAttribute(
				"href",
				`https://${
					process.env.WEBSITE_DOMAIN
				}${currentRoute.path.replace(/\/$/, "")}`,
			)
			document.head.appendChild(canonical)
		}
	}, [currentRoute])

	if (!currentRoute) {
		return <PageNotFound />
	}
	return <>{currentRoute.render()}</>
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
export function getRoutes(): Route[] {
	const routes: Route[] = [
		{path: "/", render: () => <Home />},
		{path: "/about", render: () => <About />},
	]
	const posts = getBlogPosts()
	for (const post of posts) {
		routes.push({
			path: `/blog/${post.slug}`,
			render: () => <BlogPost post={post} />,
		})
	}
	return routes
}

const BlogPost = ({post}: {post: BlogPost}) => {
	return (
		<PageLayout>
			<h1>{post.title}</h1>
			{post.render()}
		</PageLayout>
	)
}
