import {useEffect, useState} from "preact/hooks"

const STORAGE_KEY = "theme"

function getColorPreference(): string {
	if (process.env.SSR) {
		return "light"
	}
	const saved = localStorage.getItem(STORAGE_KEY)
	if (saved) {
		return saved
	} else {
		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light"
	}
}

export const ThemeSwitcher = () => {
	const [theme, setTheme] = useState(getColorPreference)

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, theme)
		document.firstElementChild?.setAttribute("data-theme", theme)
	}, [theme])

	useEffect(() => {
		const listener = ({matches}: any) => {
			setTheme(matches ? "dark" : "light")
		}

		window
			.matchMedia("(prefers-color-scheme: dark)")
			.addEventListener("change", listener)
		return () => {
			window
				.matchMedia("(prefers-color-scheme: dark)")
				.removeEventListener("change", listener)
		}
	}, [])

	return (
		<button
			class="theme-toggle"
			aria-label={theme}
			aria-live="polite"
			onClick={() => {
				setTheme(theme === "light" ? "dark" : "light")
			}}
		>
			<svg
				class="sun-and-moon"
				aria-hidden="true"
				width="24"
				height="24"
				viewBox="0 0 24 24"
			>
				<mask class="moon" id="moon-mask">
					<rect x="0" y="0" width="100%" height="100%" fill="white" />
					<circle cx="24" cy="10" r="6" fill="black" />
				</mask>
				<circle
					class="sun"
					cx="12"
					cy="12"
					r="6"
					mask="url(#moon-mask)"
					fill="currentColor"
				/>
				<g class="sun-beams" stroke="currentColor">
					<line x1="12" y1="1" x2="12" y2="3" />
					<line x1="12" y1="21" x2="12" y2="23" />
					<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
					<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
					<line x1="1" y1="12" x2="3" y2="12" />
					<line x1="21" y1="12" x2="23" y2="12" />
					<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
					<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
				</g>
			</svg>
		</button>
	)
}
