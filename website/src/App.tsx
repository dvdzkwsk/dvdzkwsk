import {History} from "history"
import {ComponentChildren} from "preact"
import {useMemo} from "preact/hooks"
import {BlogPost, getBlogPosts} from "./blog/index.js"

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
	return null
}

export interface Route {
	path: string
	render(): ComponentChildren
}

export function getRoutes(): Route[] {
	const routes: Route[] = [{path: "/", render: () => <Home />}]
	const posts = getBlogPosts()
	for (const post of posts) {
		routes.push({
			path: `/blog/${post.slug}`,
			render: () => <BlogPost post={post} />,
		})
	}
	return routes
}

const Home = () => {
	const recentBlogPosts = getBlogPosts()
	return (
		<main className="app">
			{recentBlogPosts.map((post) => {
				return <BlogPostPreview key={post.title} post={post} />
			})}
		</main>
	)
}

const BlogPost = ({post}: {post: BlogPost}) => {
	return (
		<main>
			<h1>{post.title}</h1>
			{post.render()}
		</main>
	)
}

const BlogPostPreview = ({post}: {post: BlogPost}) => {
	return (
		<article>
			<h3>{post.title}</h3>
			{post.render()}
		</article>
	)
}
