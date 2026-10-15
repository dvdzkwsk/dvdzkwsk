import {Text} from "../components/Text.js"
import {DefaultLayout} from "../layouts/DefaultLayout.js"
import {definePage} from "../RouterJson.js"

const NotFound = () => {
	return (
		<>
			<Text>Not Found</Text>
		</>
	)
}

export default definePage({
	title: "404",
	layout: DefaultLayout,
	content: NotFound,
})
