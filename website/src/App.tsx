import {History} from "history"
import {createContext} from "preact"
import {CurrentRoute, PageMetadata} from "./Router.js"
import {BlogPost} from "./Blog.js"

export interface AppContext {
	history: History
	posts: BlogPost[]
	meta: PageMetadata
	metaHtml?: string
}

export const AppContext = createContext<AppContext>(null!)

export function createAppContext(history: History): AppContext {
	return {
		history,
		meta: {},
		posts: [],
	}
}

export const App = ({context}: {context: AppContext}) => {
	return (
		<AppContext.Provider value={context}>
			<CurrentRoute />
		</AppContext.Provider>
	)
}
