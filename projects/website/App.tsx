import {History} from "history"
import * as React from "react"
import {CurrentRoute} from "./RouteMap.js"

export interface AppContextValue {
	history: History
}

export const AppContext = React.createContext<AppContextValue>(null!)

export function createAppContext(history: History): AppContextValue {
	return {
		history,
	}
}

export const App = ({context}: {context: AppContextValue}) => {
	return (
		<AppContext.Provider value={context}>
			<CurrentRoute />
		</AppContext.Provider>
	)
}
