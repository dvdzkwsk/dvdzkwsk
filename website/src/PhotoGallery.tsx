import * as css from "./PhotoGallery.css"

export const PhotoGallery = () => {
	return (
		<div className={css.root}>
			<Photo name="aviation-flying-02.jpg" />
			<Photo name="kona-standing-on-couch.jpg" />
			<Photo name="kona-photoshoot-bandana.jpg" />
			<Photo name="kona-upside-down-in-playpen.jpg" />
			<Photo name="kona-bandana-pose.jpg" />
			<Photo name="badlands-beware-rattlesnakes.jpg" />
			<Photo name="kona-nose-in-cup.jpg" />
			<Photo name="kona-pumpkin-patch.jpg" />
		</div>
	)
}

const Photo = ({name}: {name: string}) => {
	const src = `https://storage.cloud.google.com/dvdzkwsk-media/images/${name}`
	return (
		<div className={css.imgContainer}>
			<img className={css.img} src={src} />
		</div>
	)
}
