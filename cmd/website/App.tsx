import "./App.css"
import {History} from "history"
import {createContext} from "preact"
import {CurrentRoute, PageMetadata} from "./Router.js"

export interface AppContext {
	history: History
	meta: PageMetadata
	metaHtml?: string
}

export const AppContext = createContext<AppContext>(null!)

export function createAppContext(history: History): AppContext {
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
