import {Link} from "../Layout.js"
import {createBlogPost} from "./BlogPostUtil.js"

export default createBlogPost({
	title: "Quick Reflections on MDX",
	date: "2024-01-11",
	render: () => <Content />,
})

const Content = () => (
	<>
		<p>
			<Link href="https://mdxjs.com/">MDX</Link> is an extension of{" "}
			<Link href="https://en.wikipedia.org/wiki/Markdown">Markdown</Link>{" "}
			that supports inline JSX. In practice, that basically means arbitary
			JavaScript. It's popular because, well, Markdown is popular for
			static site generators, and Markdown's formatting capabilities fall
			short for non-trivial web pages.
		</p>
		<p>
			The crux: Markdown "falling short" is misleading. It offers an
			intentional tradeoff: give up some power in exchange for consistency
			and portability. Unhappy with that tradeoff, it's tempting to reach
			for MDX as a solution, and it's easy to ignore the tradeoffs on that
			side of the equation. For starters, those include: slower build
			times, worse portability with Markdown rendering and preview tools,
			the need for specialized IDE extensions, and an inability to parse
			structured data out of blackbox React components.
		</p>
		<p>
			At the same time as it tries to improve upon Markdown, MDX
			invalidates the reasons for choosing Markdown in the first place. It
			chases local a maximum and ignores where it arrives. Writing MDX is
			comparable to writing raw HTML inside a Markdown file and pretending
			that you're still just writing Markdown, as if the important part of
			Markdown is the `.md` extension and not its goals.
		</p>
		<p>
			MDX says it can give you the best of both worlds. In reality, it
			gives you your own unique, non-standard world that requires a
			complicated toolchain to work. It's far more than just a syntax
			extension; it's all of the logic in your React components, your
			dependencies, your build system. What it isn't is Markdown, and if
			you need the extra power, please just stick to React.
		</p>
	</>
)
