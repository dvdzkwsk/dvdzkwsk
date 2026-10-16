import {Logger} from "@dvdzkwsk/logger"
import {doRequest} from "@dvdzkwsk/util/ApiUtil"
import {toError} from "@dvdzkwsk/util/ErrorUtil"
import {FetchError} from "@dvdzkwsk/util/FetchUtil"
import {cx} from "@dvdzkwsk/util/ReactUtil"
import * as React from "react"
import {z} from "zod"
import {API_DOCS_SECTIONS} from "../../shared/ApiJson.js"
import {STRINGS, URLS} from "../../shared/KHLConfig.js"
import {
	API_TOKEN_ENV_VAR,
	ApiEndpointDocs,
	ApiParamDocs,
	ApiTokenSchema,
	ApiTypeEntry,
	CodeLanguage,
	generateApiToken,
	getAuthorizationValue,
	getEndpointDocs,
	getTypeIndex,
	highlightCode,
	toAnchor,
	toTypeAnchor,
} from "../ApiDocs.js"
import {Link, PageShell, SegmentedControl} from "../Components.js"
import {Route, useAsync} from "../Util.js"

// --- /api: every public endpoint, rendered from its ApiJson.ts definition.
// A sidebar of endpoints on the left; each endpoint's prose and parameters
// beside its request and response code.

const logger = new Logger("ApiPage")

const OVERVIEW_ID = "overview"

/** How far below the top of the window a section counts as the current one */
const ACTIVE_SECTION_OFFSET_PX = 120

/** The live response shows this many lines */
const RESPONSE_PREVIEW_LINES = 200

type ExampleKind = "curl" | "fetch"

const EXAMPLE_OPTIONS: {value: ExampleKind; label: string}[] = [
	{value: "curl", label: "curl"},
	{value: "fetch", label: "fetch"},
]

type ResponseView = "type" | "live"

const RESPONSE_OPTIONS: {value: ResponseView; label: string}[] = [
	{value: "type", label: "Type"},
	{value: "live", label: "Live"},
]

interface DocsSection {
	id: string
	title: string
	endpoints: ApiEndpointDocs[]
}

const TYPES_ID = "types"

/** The types in the Types section, so a mention of one can link to it */
const TypeNamesContext = React.createContext<ReadonlySet<string>>(new Set())

const ApiPage = () => {
	const origin = window.location.origin
	const [token, generateToken] = useApiToken()
	const sections = React.useMemo(
		(): DocsSection[] =>
			API_DOCS_SECTIONS.map((section) => ({
				// Prefixed: "Search" is both a group and an endpoint
				id: `group-${toAnchor(section.title)}`,
				title: section.title,
				endpoints: section.endpoints.map((endpoint) =>
					getEndpointDocs(endpoint, origin, token),
				),
			})),
		[origin, token],
	)
	const types = React.useMemo(
		() => getTypeIndex(sections.flatMap((s) => s.endpoints)),
		[sections],
	)
	const typeNames = React.useMemo(
		() => new Set(types.map((t) => t.name)),
		[types],
	)
	const anchorIds = React.useMemo(
		() => [
			OVERVIEW_ID,
			...sections.flatMap((s) => s.endpoints.map((e) => e.id)),
			TYPES_ID,
			...types.map((t) => toTypeAnchor(t.name)),
		],
		[sections, types],
	)
	const activeId = useActiveAnchor(anchorIds)
	// The browser looks for a link's #anchor before the page has rendered it
	React.useEffect(() => {
		const id = decodeURIComponent(window.location.hash.slice(1))
		if (id) {
			document.getElementById(id)?.scrollIntoView()
		}
	}, [])
	// One choice for the whole page, so every example matches
	const [exampleKind, setExampleKind] = React.useState<ExampleKind>("curl")

	return (
		<PageShell>
			<TypeNamesContext.Provider value={typeNames}>
				<div className="ApiPage">
					<ApiNav
						sections={sections}
						types={types}
						activeId={activeId}
					/>
					<div className="ApiPage-main">
						<Overview
							origin={origin}
							token={token}
							onGenerateToken={generateToken}
						/>
						{sections.map((section) => (
							<section
								key={section.id}
								id={section.id}
								className="ApiPage-group"
								aria-labelledby={`${section.id}-title`}
							>
								<h2
									id={`${section.id}-title`}
									className="ApiPage-group-title"
								>
									{section.title}
								</h2>
								{section.endpoints.map((docs) => (
									<EndpointDocs
										key={docs.id}
										docs={docs}
										exampleKind={exampleKind}
										onExampleKindChange={setExampleKind}
									/>
								))}
							</section>
						))}
						<TypesSection types={types} />
					</div>
				</div>
			</TypeNamesContext.Provider>
		</PageShell>
	)
}

// --- Sidebar

const ApiNav = ({
	sections,
	types,
	activeId,
}: {
	sections: DocsSection[]
	types: ApiTypeEntry[]
	activeId: string | null
}) => {
	// Collapsed, since there are dozens; open while one is on screen
	const [typesOpen, setTypesOpen] = React.useState(false)
	const isTypeActive =
		activeId === TYPES_ID || (activeId?.startsWith("type-") ?? false)
	React.useEffect(() => {
		if (isTypeActive) {
			setTypesOpen(true)
		}
	}, [isTypeActive])

	// Keep the current link in view as the page scrolls. Sets the sidebar's
	// own scrollTop, since scrollIntoView would scroll the window too.
	const innerRef = React.useRef<HTMLDivElement>(null)
	React.useEffect(() => {
		const inner = innerRef.current
		const link = inner?.querySelector<HTMLElement>(
			'[aria-current="location"]',
		)
		if (!inner || !link) {
			return
		}
		const margin = 48
		const top = link.offsetTop - inner.offsetTop
		const bottom = top + link.offsetHeight
		if (top - margin < inner.scrollTop) {
			inner.scrollTop = top - margin
		} else if (bottom + margin > inner.scrollTop + inner.clientHeight) {
			inner.scrollTop = bottom + margin - inner.clientHeight
		}
	}, [activeId, typesOpen])

	return (
		<nav className="ApiNav" aria-label="API reference">
			<div className="ApiNav-inner" ref={innerRef}>
				<a href={`#${OVERVIEW_ID}`} className="ApiNav-home">
					API reference
				</a>
				{sections.map((section) => (
					<div key={section.id} className="ApiNav-group">
						<h2 className="ApiNav-group-title">{section.title}</h2>
						<ul className="ApiNav-list">
							{section.endpoints.map((docs) => (
								<li key={docs.id}>
									<NavLink
										id={docs.id}
										activeId={activeId}
										label={docs.endpoint.name}
										method={docs.endpoint.method}
									/>
								</li>
							))}
						</ul>
					</div>
				))}
				<details
					className="ApiNav-group ApiNav-types"
					open={typesOpen}
					onToggle={(event) => setTypesOpen(event.currentTarget.open)}
				>
					<summary className="ApiNav-group-title ApiNav-types-toggle">
						Types
						<span className="ApiNav-count">{types.length}</span>
					</summary>
					<ul className="ApiNav-list">
						{types.map((type) => (
							<li key={type.name}>
								<NavLink
									id={toTypeAnchor(type.name)}
									activeId={activeId}
									label={type.name}
									mono
								/>
							</li>
						))}
					</ul>
				</details>
			</div>
		</nav>
	)
}

const NavLink = ({
	id,
	activeId,
	label,
	method,
	mono,
}: {
	id: string
	activeId: string | null
	label: string
	method?: string
	/** A type name, in code font */
	mono?: boolean
}) => {
	const active = id === activeId
	return (
		// A plain anchor, so the browser scrolls to the section
		<a
			href={`#${id}`}
			className={cx(
				"ApiNav-link",
				mono && "ApiNav-link--mono",
				active && "ApiNav-link--active",
			)}
			aria-current={active ? "location" : undefined}
		>
			<span className="ApiNav-link-label">{label}</span>
			{method && <span className="ApiNav-method">{method}</span>}
		</a>
	)
}

/** The last of `ids` whose element has scrolled up to the top of the window */
function useActiveAnchor(ids: string[]): string | null {
	const [activeId, setActiveId] = React.useState<string | null>(null)
	React.useEffect(() => {
		let frame = 0
		const update = () => {
			frame = 0
			let current: string | null = ids[0] ?? null
			for (const id of ids) {
				const top = document
					.getElementById(id)
					?.getBoundingClientRect().top
				if (top !== undefined && top <= ACTIVE_SECTION_OFFSET_PX) {
					current = id
				}
			}
			setActiveId(current)
		}
		const onScroll = () => {
			if (!frame) {
				frame = requestAnimationFrame(update)
			}
		}
		update()
		window.addEventListener("scroll", onScroll, {passive: true})
		window.addEventListener("resize", onScroll)
		return () => {
			window.removeEventListener("scroll", onScroll)
			window.removeEventListener("resize", onScroll)
			cancelAnimationFrame(frame)
		}
	}, [ids])
	return activeId
}

// --- Overview

/** Where this browser keeps the token it generated */
const API_TOKEN_STORAGE_KEY = "khl-api-token"

/**
 * The API token generated on this page, kept in this browser so the examples
 * show the same one on the next visit, and a function that makes a new one
 */
function useApiToken(): [string | null, () => void] {
	const [token, setToken] = React.useState(readApiToken)
	const generate = React.useCallback(() => {
		const next = generateApiToken()
		try {
			localStorage.setItem(API_TOKEN_STORAGE_KEY, next)
		} catch (error) {
			logger.warn("useApiToken", "couldn't save the API token", {
				error: toError(error),
			})
		}
		setToken(next)
	}, [])
	return [token, generate]
}

function readApiToken(): string | null {
	let value: string | null
	try {
		value = localStorage.getItem(API_TOKEN_STORAGE_KEY)
	} catch {
		// Storage is blocked; the page works without a saved token
		return null
	}
	if (value === null) {
		return null
	}
	const result = ApiTokenSchema.safeParse(value)
	if (!result.success) {
		logger.warn("readApiToken", "ignoring a malformed saved API token", {
			error: z.prettifyError(result.error),
		})
		return null
	}
	return result.data
}

const Overview = ({
	origin,
	token,
	onGenerateToken,
}: {
	origin: string
	token: string | null
	onGenerateToken: () => void
}) => {
	const authHeader = `Authorization: ${getAuthorizationValue(token)}`
	return (
		<section id={OVERVIEW_ID} className="ApiOverview">
			<div className="ApiOverview-text">
				<h1 className="ApiOverview-title">API reference</h1>
				<p className="ApiOverview-lede">
					Every schedule, score, and stat on {STRINGS.PRODUCT_NAME}{" "}
					comes from a JSON API you can call too. It's free and
					read-only.
				</p>
				<dl className="ApiOverview-facts">
					<div>
						<dt>Authentication</dt>
						<dd>
							Every request needs an API token, sent as a Bearer
							token in the <code>Authorization</code> header.{" "}
							{token ? (
								<>
									The examples below use the token you
									generated.
								</>
							) : (
								<>
									Generate one beside this, and the examples
									below will use it. Until then, they read it
									from <code>{API_TOKEN_ENV_VAR}</code>.
								</>
							)}{" "}
							Keep it secret: don't commit it or put it in a web
							page.
						</dd>
					</div>
					<div>
						<dt>Requests</dt>
						<dd>
							Plain <code>GET</code>s. Parameters go in the path
							and query string, and every response is JSON.
						</dd>
					</div>
					<div>
						<dt>Errors</dt>
						<dd>
							An <code>{`{"error": string}`}</code> body: 400 for
							an invalid parameter (it says which), 401 for a
							missing or invalid token, 404 for an id that doesn't
							exist, and 502 when the league's site failed.
						</dd>
					</div>
					<div>
						<dt>Fair use</dt>
						<dd>
							Data comes from{" "}
							<Link href={URLS.KHL}>the league's site ↗</Link> and
							is cached for a few minutes. Please cache on your
							end too, and avoid bursts of requests.
						</dd>
					</div>
					<div>
						<dt>Browsers</dt>
						<dd>
							Responses don't send CORS headers, so call the API
							from a server or script, not from a page on another
							site.
						</dd>
					</div>
				</dl>
			</div>
			<div className="ApiOverview-code">
				<CodePanel title="Base URL" copyText={`${origin}/api`}>
					<CodeBlock code={`${origin}/api`} language="shell" />
				</CodePanel>
				<CodePanel title="Authentication" copyText={authHeader}>
					<CodeBlock code={authHeader} language="shell" wrap />
					<div className="CodePanel-footer">
						<button
							type="button"
							className="CodePanel-send"
							onClick={onGenerateToken}
						>
							{token ? "Regenerate token" : "Generate token"}
						</button>
						{token && (
							<CopyButton
								text={token}
								label="Copy token"
								className="CodePanel-secondary"
							/>
						)}
					</div>
				</CodePanel>
			</div>
		</section>
	)
}

// --- One endpoint

const EndpointDocs = ({
	docs,
	exampleKind,
	onExampleKindChange,
}: {
	docs: ApiEndpointDocs
	exampleKind: ExampleKind
	onExampleKindChange: (kind: ExampleKind) => void
}) => {
	const {endpoint} = docs
	const pathParams = docs.params.filter((p) => p.location === "path")
	const otherParams = docs.params.filter((p) => p.location !== "path")
	return (
		<article
			id={docs.id}
			className="ApiEndpoint"
			aria-labelledby={`${docs.id}-name`}
		>
			<div className="ApiEndpoint-text">
				<h3 id={`${docs.id}-name`} className="ApiEndpoint-name">
					<a href={`#${docs.id}`}>{endpoint.name}</a>
				</h3>
				<RouteLine method={endpoint.method} uri={endpoint.uri} />
				<p className="ApiEndpoint-description">
					<InlineCode text={endpoint.description} />
				</p>
				{pathParams.length > 0 && (
					<ParamList title="Path parameters" params={pathParams} />
				)}
				{otherParams.length > 0 && (
					<ParamList
						title={
							docs.body ? "Body parameters" : "Query parameters"
						}
						params={otherParams}
					/>
				)}
				{docs.params.length === 0 && (
					<p className="ApiEndpoint-no-params">No parameters.</p>
				)}
				<p className="ApiEndpoint-returns">
					Returns <TypeLink name={docs.response.name} />
				</p>
			</div>
			<div className="ApiEndpoint-code">
				<RequestPanel
					docs={docs}
					exampleKind={exampleKind}
					onExampleKindChange={onExampleKindChange}
				/>
				<ResponsePanel docs={docs} />
			</div>
		</article>
	)
}

/** The method and path, with path parameters picked out */
const RouteLine = ({method, uri}: {method: string; uri: string}) => {
	return (
		<p className="ApiEndpoint-route">
			<span className="ApiEndpoint-method">{method}</span>
			<code className="ApiEndpoint-path">
				{uri.split(/(:\w+)/).map((part, i) =>
					part.startsWith(":") ? (
						<span key={i} className="ApiEndpoint-path-param">
							{part}
						</span>
					) : (
						part
					),
				)}
			</code>
		</p>
	)
}

const ParamList = ({
	title,
	params,
}: {
	title: string
	params: ApiParamDocs[]
}) => {
	return (
		<div className="ApiParams">
			<h4 className="ApiParams-title">{title}</h4>
			<ul className="ApiParams-list">
				{params.map((param) => (
					<li key={param.name} className="ApiParams-item">
						<div className="ApiParams-head">
							<code className="ApiParams-name">{param.name}</code>
							<code className="ApiParams-type">
								<TypeText text={param.type} />
							</code>
							{param.required ? (
								<span className="ApiParams-required">
									required
								</span>
							) : (
								<span className="ApiParams-optional">
									optional
								</span>
							)}
						</div>
						{param.description && (
							<p className="ApiParams-description">
								<InlineCode text={param.description} />
							</p>
						)}
					</li>
				))}
			</ul>
		</div>
	)
}

// --- Code panels

const RequestPanel = ({
	docs,
	exampleKind,
	onExampleKindChange,
}: {
	docs: ApiEndpointDocs
	exampleKind: ExampleKind
	onExampleKindChange: (kind: ExampleKind) => void
}) => {
	const code = exampleKind === "curl" ? docs.curl : docs.fetch
	return (
		<CodePanel
			title="Request"
			tabs={
				<SegmentedControl
					label="Example language"
					options={EXAMPLE_OPTIONS}
					value={exampleKind}
					onChange={onExampleKindChange}
				/>
			}
			copyText={code}
		>
			<CodeBlock
				code={code}
				language={exampleKind === "curl" ? "shell" : "ts"}
				wrap
			/>
		</CodePanel>
	)
}

const ResponsePanel = ({docs}: {docs: ApiEndpointDocs}) => {
	const [view, setView] = React.useState<ResponseView>("type")
	// 0 until the first send; each send bumps it, so the request reruns
	const [sendCount, setSendCount] = React.useState(0)
	const types = docs.response.declarations.map((d) => d.code).join("\n\n")
	const send = () => {
		setView("live")
		setSendCount((n) => n + 1)
	}
	return (
		<CodePanel
			title="Response"
			tabs={
				<SegmentedControl
					label="Response view"
					options={RESPONSE_OPTIONS}
					value={view}
					onChange={setView}
				/>
			}
			actions={
				view === "live" ? (
					<button
						type="button"
						className="CodePanel-send"
						onClick={send}
					>
						<PlayIcon />
						{sendCount > 0 ? "Send again" : "Send"}
					</button>
				) : undefined
			}
			copyText={view === "type" ? types : undefined}
		>
			{view === "type" ? (
				<CodeBlock code={types} language="ts" scroll />
			) : sendCount === 0 ? (
				<div className="CodePanel-empty">
					<p>
						Send the request above to {window.location.host} and see
						what comes back.
					</p>
					<button
						type="button"
						className="CodePanel-send"
						onClick={send}
					>
						<PlayIcon />
						Send request
					</button>
				</div>
			) : (
				<LiveResponse docs={docs} sendCount={sendCount} />
			)}
		</CodePanel>
	)
}

interface TimedResponse {
	json: string
	bytes: number
	ms: number
}

const LiveResponse = ({
	docs,
	sendCount,
}: {
	docs: ApiEndpointDocs
	sendCount: number
}) => {
	const state = useAsync(async (): Promise<TimedResponse> => {
		const start = performance.now()
		const data = await doRequest(
			docs.endpoint,
			docs.endpoint.exampleRequest,
		)
		const ms = performance.now() - start
		const json = JSON.stringify(data, null, 2)
		return {json, bytes: new TextEncoder().encode(json).length, ms}
	}, [docs.endpoint, sendCount])

	if (state.status === "loading") {
		return (
			<p className="CodePanel-status" role="status">
				<span className="CodePanel-spinner" aria-hidden />
				Sending request…
			</p>
		)
	}
	if (state.status === "error") {
		const {error} = state
		const status = error instanceof FetchError ? error.status : null
		const message =
			error instanceof FetchError
				? (error.serverMessage ?? error.message)
				: error.message
		return (
			<>
				<p className="CodePanel-status">
					{status === null ? (
						<span className="CodePanel-failed">Failed</span>
					) : (
						<StatusBadge status={status} />
					)}
				</p>
				<CodeBlock code={message} language="shell" wrap />
			</>
		)
	}
	const {json, bytes, ms} = state.data
	const lines = json.split("\n")
	const shown = lines.slice(0, RESPONSE_PREVIEW_LINES)
	return (
		<>
			<p className="CodePanel-status">
				<StatusBadge status={200} />
				<span>{formatBytes(bytes)}</span>
				<span>{Math.round(ms).toLocaleString()} ms</span>
			</p>
			<CodeBlock code={shown.join("\n")} language="json" scroll />
			{lines.length > shown.length && (
				<p className="CodePanel-footnote">
					Showing the first {shown.length} of{" "}
					{lines.length.toLocaleString()} lines.
				</p>
			)}
		</>
	)
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`
	}
	const kb = bytes / 1024
	return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`
}

const STATUS_TEXT: Record<number, string> = {
	200: "OK",
	400: "Bad Request",
	404: "Not Found",
	500: "Internal Server Error",
	502: "Bad Gateway",
}

const StatusBadge = ({status}: {status: number}) => {
	return (
		<span
			className={cx(
				"StatusBadge",
				status < 300 ? "StatusBadge--ok" : "StatusBadge--error",
			)}
		>
			{status} {STATUS_TEXT[status] ?? ""}
		</span>
	)
}

/**
 * A dark panel of code: a header with a title or tabs, actions, and a copy
 * button, over its content.
 */
const CodePanel = ({
	title,
	tabs,
	actions,
	copyText,
	children,
}: {
	title: React.ReactNode
	/** Replaces the title on wide panels; the title stays for screen readers */
	tabs?: React.ReactNode
	actions?: React.ReactNode
	/** Shows a copy button for this text */
	copyText?: string
	children: React.ReactNode
}) => {
	return (
		<div className="CodePanel">
			<div className="CodePanel-header">
				<div
					className={cx(
						"CodePanel-title",
						tabs !== undefined && "CodePanel-title--with-tabs",
					)}
				>
					{title}
				</div>
				{tabs}
				<div className="CodePanel-actions">
					{actions}
					{copyText !== undefined && <CopyButton text={copyText} />}
				</div>
			</div>
			<div className="CodePanel-body">{children}</div>
		</div>
	)
}

const CopyButton = ({
	text,
	label = "Copy",
	className = "CodePanel-copy",
}: {
	text: string
	/** What it copies, e.g. "Copy token"; "Copied" once it has */
	label?: string
	className?: string
}) => {
	const [copied, setCopied] = React.useState(false)
	React.useEffect(() => {
		if (!copied) {
			return
		}
		const timer = setTimeout(() => setCopied(false), 1500)
		return () => clearTimeout(timer)
	}, [copied])

	const copy = () => {
		navigator.clipboard.writeText(text).then(
			() => setCopied(true),
			(cause: unknown) => {
				logger.warn("copy", "couldn't copy to the clipboard", {
					error: toError(cause),
				})
			},
		)
	}

	return (
		<button
			type="button"
			className={className}
			onClick={copy}
			aria-label={copied ? "Copied" : label}
		>
			{copied ? <CheckIcon /> : <CopyIcon />}
			<span className="CodePanel-copy-label">
				{copied ? "Copied" : label}
			</span>
		</button>
	)
}

const CodeBlock = ({
	code,
	language,
	wrap,
	scroll,
}: {
	code: string
	language: CodeLanguage
	/** Wrap long lines, e.g. a curl command's URL */
	wrap?: boolean
	/** Cap the height and scroll, for long types and responses */
	scroll?: boolean
}) => {
	const typeNames = React.useContext(TypeNamesContext)
	const tokens = React.useMemo(
		() => highlightCode(code, language),
		[code, language],
	)
	return (
		<pre
			className={cx(
				"CodeBlock",
				wrap && "CodeBlock--wrap",
				scroll && "CodeBlock--scroll",
			)}
		>
			<code>
				{tokens.map((token, i) => {
					if (token.kind === "plain") {
						return token.text
					}
					const className = `CodeBlock-${token.kind}`
					// References only: a declaration's own name isn't a link
					const isTypeName =
						token.kind === "type" && typeNames.has(token.text)
					return isTypeName ? (
						<a
							key={i}
							href={`#${toTypeAnchor(token.text)}`}
							className={cx(className, "CodeBlock-link")}
						>
							{token.text}
						</a>
					) : (
						<span key={i} className={className}>
							{token.text}
						</span>
					)
				})}
			</code>
		</pre>
	)
}

/** A link to a type's declaration in the Types section */
const TypeLink = ({name}: {name: string}) => {
	return (
		<a href={`#${toTypeAnchor(name)}`} className="TypeLink">
			{name}
		</a>
	)
}

/** A type expression, e.g. "ClientLog[]", with its named types linked */
const TypeText = ({text}: {text: string}) => {
	const typeNames = React.useContext(TypeNamesContext)
	return (
		<>
			{text
				.split(/([A-Za-z_$][\w$]*)/)
				.map((part, i) =>
					typeNames.has(part) ? (
						<TypeLink key={i} name={part} />
					) : (
						part
					),
				)}
		</>
	)
}

// --- Types section

const TypesSection = ({types}: {types: ApiTypeEntry[]}) => {
	return (
		<section
			id={TYPES_ID}
			className="ApiPage-group"
			aria-labelledby={`${TYPES_ID}-title`}
		>
			<h2 id={`${TYPES_ID}-title`} className="ApiPage-group-title">
				Types
			</h2>
			<p className="ApiPage-group-lede">
				Every type the endpoints take and return, generated from the
				same schemas the server checks requests and responses against.
			</p>
			<div className="ApiTypes">
				{types.map((type) => (
					<article
						key={type.name}
						id={toTypeAnchor(type.name)}
						className="ApiType"
						aria-labelledby={`${toTypeAnchor(type.name)}-name`}
					>
						<div className="ApiType-header">
							<h3
								id={`${toTypeAnchor(type.name)}-name`}
								className="ApiType-name"
							>
								<a href={`#${toTypeAnchor(type.name)}`}>
									{type.name}
								</a>
							</h3>
							<p className="ApiType-used-by">
								Used by{" "}
								{type.usedBy.map((docs, i) => (
									<React.Fragment key={docs.id}>
										{i > 0 && ", "}
										<a href={`#${docs.id}`}>
											{docs.endpoint.name}
										</a>
									</React.Fragment>
								))}
							</p>
						</div>
						<CodePanel
							title={
								type.code.startsWith("interface")
									? "Interface"
									: "Type"
							}
							copyText={type.code}
						>
							<CodeBlock code={type.code} language="ts" />
						</CodePanel>
					</article>
				))}
			</div>
		</section>
	)
}

/** `text` with its `backticked` spans as code */
const InlineCode = ({text}: {text: string}) => {
	return (
		<>
			{text
				.split("`")
				.map((part, i) =>
					i % 2 === 1 ? <code key={i}>{part}</code> : part,
				)}
		</>
	)
}

// --- Icons

const CopyIcon = () => {
	return (
		<svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor">
			<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
			<path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
		</svg>
	)
}

const CheckIcon = () => {
	return (
		<svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor">
			<path d="M3 8.5l3 3 7-7" strokeWidth="1.75" />
		</svg>
	)
}

const PlayIcon = () => {
	return (
		<svg viewBox="0 0 16 16" aria-hidden fill="currentColor">
			<path d="M5 3.5v9l7.5-4.5z" />
		</svg>
	)
}

export const ApiRoute = {
	path: "/api",
	title: "API",
	description: `Documentation for the ${STRINGS.PRODUCT_NAME} JSON API: endpoints, parameters, examples, and response types.`,
	content: ApiPage,
} as const satisfies Route
