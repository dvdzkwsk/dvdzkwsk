import {createBlogPost} from "./BlogUtil.js"
import {Link} from "../Router.js"
import {CodeBlock} from "../components/CodeBlock.js"

export default createBlogPost({
	title: "Quick Thoughts on Public Interfaces",
	date: "2024-02-10",
	render: () => <Content />,
	preview: () => (
		<p>
			So you've got a cool library that does useful things. That's
			amazing. Great work. Even better, it has helpful logging to help
			people understand what it's doing when things go wrong. Well, read
			more, since this post explores different ways to design an interface
			for a logger module.
		</p>
	),
})

const Content = () => (
	<>
		<p>
			So you've got a cool library that does useful things. That's
			amazing. Great work. Even better, it has helpful logging to help
			people understand what it's doing when things go wrong.
		</p>
		<CodeBlock language="typescript">
			{`
const logger = new Logger()

export function doWork(userId: string) {
    if (!condition) {
        logger.log(\`warning! this thing might not work for user: \${userId}\`)
    }
    doPart1(userId)
    doPart2(userId)
}

function doPart1(userId: string) {
    logger.log(\`started part 1 for user: \${userId}\`)
    // ...
    logger.debug('still doing stuff in part 1')
    // ...
    logger.log(\`finished part 1 for user: \${userId}\`)
}

function doPart2(userId: string) {
    logger.log(\`started part 2 for user: \${userId}\`)
    // ...
    logger.debug('still doing stuff in part 2')
    // ...
    logger.log(\`finished part 2 for user: \${userId}\`)
}
`}
		</CodeBlock>
		<p>
			These logs are a great start. Then you learn a bit about{" "}
			<Link href="https://stackify.com/what-is-structured-logging-and-why-developers-need-it/">
				structured logging
			</Link>{" "}
			and your logging starts to look more like this:
		</p>
		<CodeBlock language="typescript">
			{`
const logger = new Logger()

export function doWork(userId: string) {
    if (!condition) {
        logger.warn("hey this thing might not work", { userId })
    }
    doPart1(userId)
    doPart2(userId)
}

function doPart1(userId: string) {
    return logger.profile("doPart1", { userId }, (profile) => {
        // ...
        profile.debug('still doing stuff in part 1')
        // ...
    })
}

function doPart2(userId: string) {
    return logger.profile("doPart2", { userId }, (profile) => {
        // ...
        profile.debug('still doing stuff in part 2')
        // ...
    })
}
`}
		</CodeBlock>
		<p>
			Being good citizen of the world, you allow users of your library to
			swap out `logger`. Maybe they want to write the logs to a file, or
			silence them, or who knows what. Point is, where logs go is not your
			decision to make.
		</p>
		<CodeBlock language="typescript">
			{`
type LogInfo = Record<string, unknown>
type ProfileFn<T> = (profile: Logger) => T

export interface Logger {
    info(message: string, info: LogInfo): void
    debug(message: string, info: LogInfo): void
    warn(message: string, info: LogInfo): void
    profile<T>(message: string, info: LogInfo, fn: ProfileFn<T>): T
}

export function doWork(userId: string, logger: Logger) {
    if (!condition) {
        logger.warn("hey this thing might not work", { userId })
    }
    doPart1(userId)
    doPart2(userId)
}

function doPart1(userId: string, logger: Logger) {
    return logger.profile("doPart1", { userId }, () => {
        // ...
    })
}

function doPart2(userId: string, logger: Logger) {
    return logger.profile("doPart2", { userId }, () => {
        // ...
    })
}
`}
		</CodeBlock>
		<p>
			The thing is, this kinda sucks. The `Logger` interface is really
			wide. It's got handy convenience methods for logging with a specific
			severity, this `profile` thingy, and probably more. It's just a lot
			for somebody to have to implement, and most of it isn't even
			directly related to the actual act of logging.
		</p>
		<p>Here's what you should do instead:</p>
		<CodeBlock language="typescript">
			{`
type LogInfo = Record<string, unknown>

export inteface LogMessage {
    message: string
    info: LogInfo
}

export interface Logger {
    log(message: LogMessage): void
}

class InternalLogger {
    constructor(private logger: Logger) {}

    debug(message: string, info: LogInfo) {
        this.logger.log(message, { level: "debug", ...info })
    }

    warn(message: string, info: LogInfo) {
        this.logger.log(message, { level: "warn", ...info })
    }

    // ... etc ...
}

export function doWork(userId: string, loggerArg: Logger) {
    const logger = new InternalLogger(loggerArg)
    if (!condition) {
        logger.warn("hey this thing might not work", { userId })
    }
    doPart1(userId)
    doPart2(userId)
}

function doPart1(userId: string, logger: InternalLogger) {
    return logger.profile("doPart1", { userId }, () => {
        // ...
    })
}

function doPart2(userId: string, logger: InternalLogger) {
    return logger.profile("doPart2", { userId }, () => {
        // ...
    })
}
`}
		</CodeBlock>
	</>
)
