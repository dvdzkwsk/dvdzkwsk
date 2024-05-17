import {useMemo} from "preact/hooks"
import hljs from "highlight.js/lib/core"
import typescript from "highlight.js/lib/languages/typescript"

type SupportedLanguage = "typescript"

hljs.registerLanguage("typescript", typescript)

export const CodeBlock = ({
	language,
	children,
}: {
	language: SupportedLanguage
	children: string
}) => {
	const codeTheme = "github"
	const html = useMemo(() => {
		let source = children.split("\n")
		for (let i = 0; i < source.length; i++) {
			if (source[i].trim()) {
				source = source.slice(i)
				break
			}
		}
		const result = hljs.highlight(source.join("\n"), {
			language,
		})
		return result.value
	}, [])
	return (
		<pre className={`Code theme-${codeTheme}`}>
			<code dangerouslySetInnerHTML={{__html: html}} />
		</pre>
	)
}
