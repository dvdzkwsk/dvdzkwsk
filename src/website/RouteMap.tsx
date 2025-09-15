import * as React from "react"
import {Location} from "history"
import {AppContext} from "./App.js"
import HomePage from "./pages/Home.js"
import NotFoundPage from "./pages/NotFound.js"
import {PageSchema} from "./RouterJson.js"
import {Helmet} from "react-helmet"

const WEBSITE_DOMAIN = "dvdzkwsk.com"

export const ROUTE_MAP: {
	[uri: string]: PageSchema
} = {
	"/": HomePage,
	"/404": NotFoundPage,
}

export const CurrentRoute = () => {
	const context = React.useContext(AppContext)
	const [, forceUpdate] = React.useState<any>(null)

	let pathname = context.history.location.pathname.replace(/\/$/, "")
	if (pathname === "") {
		pathname = "/"
	}
	const currentPage = ROUTE_MAP[pathname] ?? ROUTE_MAP["/404"]

	React.useEffect(() => {
		return context.history.listen(() => forceUpdate({}))
	}, [context.history])

	return renderPage(currentPage, context.history.location)
}

function renderPage(page: PageSchema, location: Location) {
	const Layout = page.layout
	const Content = page.content
	return (
		<>
			<PageMetadata page={page} location={location} />
			<Layout>
				<Content />
			</Layout>
		</>
	)
}

export interface PageMetadataProps {
	page: PageSchema
	location: Location
}
const PageMetadata = ({page, location}: PageMetadataProps) => {
	return (
		<Helmet>
			{page.title && (
				<title>
					{page.title === "Home"
						? "David Zukowski"
						: page.title + " | David Zukowski"}
				</title>
			)}
			{page.title && <meta name="title" content={page.title} />}
			{page.title && <meta property="og:title" content={page.title} />}
			<meta name="author" content="David Zukowski" />
			{page.description && (
				<meta property="og:description" content={page.description} />
			)}
			<meta property="og:site_name" content="David Zukowski" />
			{WEBSITE_DOMAIN && (
				<meta
					property="og:url"
					content={`https://${WEBSITE_DOMAIN}${location.pathname}`}
				/>
			)}
			{WEBSITE_DOMAIN && (
				<link
					rel="canonical"
					href={`https://${WEBSITE_DOMAIN}${location.pathname}`}
				/>
			)}
		</Helmet>
	)
}
