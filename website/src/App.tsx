import * as css from "./App.css"
import {PhotoGallery} from "./PhotoGallery"

export const App = () => {
	return (
		<div className={css.root}>
			<PhotoGallery />
		</div>
	)
}
