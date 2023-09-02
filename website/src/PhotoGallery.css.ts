import {style} from "@vanilla-extract/css"

export const root = style({
	display: "grid",
	gridTemplateColumns: "1fr 1fr 1fr",
	gap: "1rem",
	width: "100%",
	maxWidth: "1000px",
	margin: "0 auto",
})

export const imgContainer = style({
	aspectRatio: "1 / 1",
	background: "rgb(230, 230, 230)",
	borderRadius: "5px",
	overflow: "hidden",
})

export const img = style({
	display: "block",
	width: "100%",
	height: "100%",
	objectFit: "cover",
})
