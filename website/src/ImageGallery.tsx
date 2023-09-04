import "./ImageGallery.css"

export const ImageGallery = () => {
	return (
		<div className="ImageGallery">
			<ul className="ImageGallery-List">
				<Image name="aviation-flying-02.jpg" />
				<Image name="kona-standing-on-couch.jpg" />
				<Image name="kona-photoshoot-bandana.jpg" />
				<Image name="kona-upside-down-in-playpen.jpg" />
				<Image name="kona-bandana-pose.jpg" />
				<Image name="badlands-beware-rattlesnakes.jpg" />
				<Image name="kona-nose-in-cup.jpg" />
				<Image name="kona-pumpkin-patch.jpg" />
			</ul>
		</div>
	)
}

const Image = ({name}: {name: string}) => {
	const src = `https://cdn.zuko.me/images/${name}`
	return (
		<li className="ImageGallery-ListItem">
			<img src={src} />
		</li>
	)
}
