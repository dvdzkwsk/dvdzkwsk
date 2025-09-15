import * as React from "react"
import {History} from "history"
import {CurrentRoute} from "./RouteMap.js"

export interface AppContext {
	history: History
}

export const AppContext = React.createContext<AppContext>(null!)

export function createAppContext(history: History): AppContext {
	return {
		history,
	}
}

export const App = ({context}: {context: AppContext}) => {
	return (
		<AppContext.Provider value={context}>
			<CurrentRoute />
		</AppContext.Provider>
	)
}
