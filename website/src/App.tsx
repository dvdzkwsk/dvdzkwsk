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

const PageLayout = ({children}: {children: ComponentChildren}) => {
	return (
		<div className="PageLayout">
			<header className="PageHeader">
				<nav className="container PageHeader-content">
					<a href="/" className="PageTitle">
						David Zukowski
					</a>
					<div className="PageHeader-links">
						<a
							href="https://github.com/davezuko"
							rel="noopener noreferrer"
						>
							GitHub
						</a>
					</div>
				</nav>
			</header>
			<main className="PageMain">
				<div className="container PageMain-content">{children}</div>
			</main>
		</div>
	)
}

const Home = () => {
	const recentBlogPosts = getBlogPosts()
	return (
		<PageLayout>
			{recentBlogPosts.map((post) => {
				return <BlogPostPreview key={post.title} post={post} />
			})}
		</PageLayout>
	)
}

const BlogPost = ({post}: {post: BlogPost}) => {
	return (
		<PageLayout>
			<h1>{post.title}</h1>
			{post.render()}
		</PageLayout>
	)
}

const BlogPostPreview = ({post}: {post: BlogPost}) => {
	return (
		<article>
			<h2>{post.title}</h2>
			{post.render()}
		</article>
	)
}
