import {createContext, useContext} from "preact/compat"

export interface AppContext {}

const AppContext = createContext<AppContext>(null!)

export function useAppContext(): AppContext {
	return useContext(AppContext)
}

export function createAppContext(): AppContext {
	return {}
}

export const App = ({context}: {context: AppContext}) => {
	return (
		<AppContext.Provider value={context}>
			<h1>Hello</h1>
		</AppContext.Provider>
	)
}
