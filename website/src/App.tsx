import {History} from "history"
import {ComponentChildren} from "preact"
import {useMemo} from "preact/hooks"
import {getBlogPosts} from "./blog/index.js"
import {PageLayout} from "./Layout.js"
import {About} from "./About.js"
import {Home} from "./Home.js"
import {BlogPost} from "./blog/BlogPostUtil.js"

export const App = ({history}: {history: History}) => {
	const routes = useMemo(getRoutes, [])
	const currentRoute = routes.find((route) => {
		return history.location.pathname === route.path
	})
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
