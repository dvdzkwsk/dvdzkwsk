import "./styles.css"
import {Logger} from "@dvdzkwsk/logger"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {createBrowserHistory, Location} from "history"
import * as React from "react"
import {createRoot} from "react-dom/client"
import {Helmet} from "react-helmet"
import {
	ErrorBoundary,
	PageShell,
	NotFoundState,
	SiteFooter,
	SiteHeader,
} from "./Components.js"
import {STRINGS, URLS} from "../shared/KHLConfig.js"
import {AboutRoute} from "./pages/AboutPage.js"
import {AdminRoute} from "./pages/AdminPage.js"
import {ApiRoute} from "./pages/ApiPage.js"
import {BadgesRoute} from "./pages/BadgesPage.js"
import {GameRoute} from "./pages/GamePage.js"
import {HelpRoute} from "./pages/HelpPage.js"
import {GamesRoute, HomeRoute} from "./pages/HomePage.js"
import {MatchupRoute} from "./pages/MatchupPage.js"
import {PlayerRoute} from "./pages/PlayerPage.js"
import {PlayersRoute} from "./pages/PlayersPage.js"
import {RinkRoute} from "./pages/RinkPage.js"
import {StatusRoute} from "./pages/StatusPage.js"
import {TeamRoute} from "./pages/TeamPage.js"
import {TeamsRoute} from "./pages/TeamsPage.js"
import {
	AppContext,
	AppContextValue,
	createAppContext,
	initClientLogging,
	IS_DEV,
	Route,
} from "./Util.js"

// --- App

export const App = ({context}: {context: AppContextValue}) => {
	return (
		<AppContext.Provider value={context}>
			<SiteHeader />
			<CurrentRoute />
			<SiteFooter />
		</AppContext.Provider>
	)
}

// --- Router

const ROUTES: Route[] = [
	HomeRoute,
	GamesRoute,
	GameRoute,
	PlayersRoute,
	PlayerRoute,
	BadgesRoute,
	TeamsRoute,
	TeamRoute,
	RinkRoute,
	MatchupRoute,
	AboutRoute,
	HelpRoute,
	ApiRoute,
	StatusRoute,
	...(IS_DEV ? [AdminRoute] : []),
]

export const CurrentRoute = () => {
	const context = React.useContext(AppContext)
	const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0)

	React.useEffect(() => {
		const unlisten = context.history.listen(() => forceUpdate())
		// Child effects run before this one, so a page may already have changed
		// the URL (e.g. a redirect) before we subscribed; catch up now.
		forceUpdate()
		return unlisten
	}, [context.history])

	const location = context.history.location
	const match = matchRoute(location.pathname) ?? {
		route: NotFoundRoute,
		params: {},
	}
	return renderRoute(match.route, match.params, location)
}

function matchRoute(
	pathname: string,
): {route: Route; params: Record<string, string>} | null {
	const segments = trimSlashes(pathname).split("/")
	for (const route of ROUTES) {
		const routeSegments = trimSlashes(route.path).split("/")
		if (routeSegments.length !== segments.length) {
			continue
		}
		const params: Record<string, string> = {}
		const matches = routeSegments.every((routeSegment, i) => {
			const segment = segments[i]!
			if (routeSegment.startsWith(":")) {
				const value = safeDecodeURIComponent(segment)
				params[routeSegment.slice(1)] = value ?? ""
				return value !== null && segment !== ""
			}
			return routeSegment === segment
		})
		if (matches) {
			return {route, params}
		}
	}
	return null
}

/**
 * Null for a malformed escape (e.g. "/players/%E0"). The router renders above
 * every ErrorBoundary, so a throw here would blank the whole app.
 */
function safeDecodeURIComponent(value: string): string | null {
	try {
		return decodeURIComponent(value)
	} catch {
		return null
	}
}

function trimSlashes(path: string): string {
	return path.replace(/^\/+|\/+$/g, "")
}

function renderRoute(
	route: Route,
	params: Record<string, string>,
	location: Location,
) {
	const Content = route.content
	return (
		<>
			<RouteMetadata route={route} location={location} />
			{/* Keyed like the page, so navigating away clears a crashed page */}
			<ErrorBoundary key={location.pathname}>
				<Content
					// Remount on a new page so it doesn't show stale data. Query string
					// changes (filters, search terms) re-render in place instead.
					key={location.pathname}
					params={params}
					query={new URLSearchParams(location.search)}
				/>
			</ErrorBoundary>
		</>
	)
}

export interface PageMetadataProps {
	route: Route
	location: Location
}
const RouteMetadata = ({route, location}: PageMetadataProps) => {
	return (
		<Helmet>
			{route.title && (
				<title>
					{route.title === "Home"
						? STRINGS.PRODUCT_NAME
						: route.title + " | " + STRINGS.PRODUCT_NAME}
				</title>
			)}
			{route.title && <meta name="title" content={route.title} />}
			{route.title && <meta property="og:title" content={route.title} />}
			{route.description && (
				<meta property="og:description" content={route.description} />
			)}
			<meta property="og:site_name" content={STRINGS.PRODUCT_NAME} />
			{URLS.WEBSITE_DOMAIN && (
				<meta
					property="og:url"
					content={`https://${URLS.WEBSITE_DOMAIN}${location.pathname}`}
				/>
			)}
			{URLS.WEBSITE_DOMAIN && (
				<link
					rel="canonical"
					href={`https://${URLS.WEBSITE_DOMAIN}${location.pathname}`}
				/>
			)}
		</Helmet>
	)
}

// --- Not found

const NotFoundPage = () => {
	return (
		<PageShell>
			<NotFoundState />
		</PageShell>
	)
}

export const NotFoundRoute = {
	path: "/404",
	title: "Not Found",
	content: NotFoundPage,
} as const satisfies Route

// --- Entry

function main() {
	initClientLogging()
	const logger = new Logger("React")
	const history = createBrowserHistory()
	const context = createAppContext(history)
	const root = createRoot(document.getElementById("root")!, {
		// Rendering errors: caught ones are shown by an ErrorBoundary
		onCaughtError: (error, info) => {
			logger.error("onCaughtError", "render error", {
				error: toError(error),
				componentStack: info.componentStack,
			})
		},
		onUncaughtError: (error, info) => {
			logger.error("onUncaughtError", "uncaught render error", {
				error: toError(error),
				componentStack: info.componentStack,
			})
		},
		onRecoverableError: (error, info) => {
			logger.warn("onRecoverableError", "recovered from render error", {
				error: toError(error),
				componentStack: info.componentStack,
			})
		},
	})
	root.render(<App context={context} />)
}

main()
