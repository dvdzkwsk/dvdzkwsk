import * as cp from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {createCliTool} from "../pkg/util/CliUtil.js"
import {toError} from "../pkg/util/ErrorUtil.js"
import {Logger} from "../pkg/util/Logger.js"

const logger = new Logger("SetupMac")
const PROJECT_ROOT = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"..",
)

// USB HID usage page 0x07 (keyboard) key codes, used by hidutil key remapping.
const HID_KEY_CAPSLOCK = "0x700000039"
const HID_KEY_ESCAPE = "0x700000029"

interface ProgramOptions {
	force: boolean
}

interface SetupContext {
	warnings: string[]
}

async function ensureMacSetup() {
	const options: ProgramOptions = {
		force: process.argv.includes("--force"),
	}
	const ctx: SetupContext = {warnings: []}

	await ensureHomebrew(ctx)
	await ensureOSXSettings(ctx)
	await ensureDotFilesLinked(options, ctx)
	await ensureConfigFilesLinked(options, ctx)
	await ensureITermSettings(options, ctx)
	await ensureZshSetup(ctx)
	await ensureGitConfig(ctx)
	await ensureSshSetup(ctx)
	await ensureCliApps(ctx)
	await ensureDesktopApps(ctx)
	await ensureNode(ctx)
	await ensureFonts(ctx)

	if (ctx.warnings.length) {
		logger.warn("ensureMacSetup", `${ctx.warnings.length} warning(s):`)
		for (const w of ctx.warnings) {
			logger.warn("ensureMacSetup", w)
		}
	}
}

interface OSXSetting {
	description: string
	restartProcess?: string
	isApplied(): boolean
	apply(): void
}

function osxSetting(opts: {
	description: string
	domain: string
	key: string
	flag: "-bool" | "-int" | "-float" | "-string"
	value: boolean | number | string
	restartProcess?: string
}): OSXSetting {
	const expectedStr =
		typeof opts.value === "boolean"
			? opts.value
				? "1"
				: "0"
			: String(opts.value)

	return {
		description: opts.description,
		restartProcess: opts.restartProcess,
		isApplied() {
			try {
				const current = cp
					.execSync(`defaults read ${opts.domain} ${opts.key}`, {
						encoding: "utf8",
						stdio: ["ignore", "pipe", "ignore"],
					})
					.trim()
				return current === expectedStr
			} catch {
				return false
			}
		},
		apply() {
			const val = opts.flag === "-string" ? `"${opts.value}"` : opts.value
			execSync(
				`defaults write ${opts.domain} ${opts.key} ${opts.flag} ${val}`,
			)
		},
	}
}

async function ensureZshSetup(_ctx: SetupContext) {
	const zshrcLocal = path.join(os.homedir(), ".zshrc_local")
	if (!fs.existsSync(zshrcLocal)) {
		logger.info("ensureZshSetup", "creating ~/.zshrc_local")
		fs.writeFileSync(zshrcLocal, "", {encoding: "utf8"})
	} else {
		logger.debug(
			"ensureZshSetup",
			"~/.zshrc_local already exists, skipping",
		)
	}
}

async function ensureHomebrew(_ctx: SetupContext) {
	if (!commandExists("brew")) {
		logger.info("ensureHomebrew", "installing homebrew...")
		execSync(
			'/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
		)
	}
}

async function ensureOSXSettings(_ctx: SetupContext) {
	const screenshotsDir = path.join(os.homedir(), "Screenshots")

	const settings: OSXSetting[] = [
		// https://apple.stackexchange.com/questions/332769/macos-disable-popup-showing-accented-characters-when-holding-down-a-key
		osxSetting({
			description: "Disable press-and-hold for accented characters",
			domain: "NSGlobalDomain",
			key: "ApplePressAndHoldEnabled",
			flag: "-bool",
			value: false,
		}),
		osxSetting({
			description: "Disable smart quote substitution",
			domain: "NSGlobalDomain",
			key: "NSAutomaticQuoteSubstitutionEnabled",
			flag: "-bool",
			value: false,
		}),
		osxSetting({
			description: "Disable smart dash substitution",
			domain: "NSGlobalDomain",
			key: "NSAutomaticDashSubstitutionEnabled",
			flag: "-bool",
			value: false,
		}),
		osxSetting({
			description: "Disable autocorrect",
			domain: "NSGlobalDomain",
			key: "NSAutomaticSpellingCorrectionEnabled",
			flag: "-bool",
			value: false,
		}),
		osxSetting({
			description: "Save to disk by default (not iCloud)",
			domain: "NSGlobalDomain",
			key: "NSDocumentSaveNewDocumentsToCloud",
			flag: "-bool",
			value: false,
		}),
		osxSetting({
			description: "Expand save dialog by default",
			domain: "NSGlobalDomain",
			key: "NSNavPanelExpandedStateForSaveMode",
			flag: "-bool",
			value: true,
		}),
		osxSetting({
			description: "Expand print dialog by default",
			domain: "NSGlobalDomain",
			key: "PMPrintingExpandedStateForPrint2",
			flag: "-bool",
			value: true,
		}),
		osxSetting({
			description: "Empty trash securely by default",
			domain: "com.apple.finder",
			key: "EmptyTrashSecurely",
			flag: "-bool",
			value: true,
		}),
		{
			description: "Show ~/Library folder",
			isApplied() {
				try {
					const output = cp.execSync(
						`ls -lOd ${path.join(os.homedir(), "Library")}`,
						{encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]},
					)
					return !/\bhidden\b/.test(output)
				} catch {
					return false
				}
			},
			apply() {
				execSync(
					`chflags nohidden ${path.join(os.homedir(), "Library")}`,
				)
			},
		},
		osxSetting({
			description: "Disable natural (Lion-style) scrolling",
			domain: "NSGlobalDomain",
			key: "com.apple.swipescrolldirection",
			flag: "-bool",
			value: false,
		}),
		osxSetting({
			description: "Enable full keyboard access for all controls",
			domain: "NSGlobalDomain",
			key: "AppleKeyboardUIMode",
			flag: "-int",
			value: 3,
		}),
		osxSetting({
			description: "Set blazingly fast keyboard repeat rate",
			domain: "NSGlobalDomain",
			key: "KeyRepeat",
			flag: "-int",
			value: 1,
		}),
		osxSetting({
			description: "Set short initial key repeat delay",
			domain: "NSGlobalDomain",
			key: "InitialKeyRepeat",
			flag: "-int",
			value: 12,
		}),
		{
			description: "Remap CapsLock to Escape",
			isApplied() {
				const plistPath = path.join(
					os.homedir(),
					"Library/LaunchAgents/com.local.KeyRemapping.plist",
				)
				if (!fs.existsSync(plistPath)) return false
				const contents = fs.readFileSync(plistPath, "utf8")
				return (
					contents.includes(HID_KEY_CAPSLOCK) &&
					contents.includes(HID_KEY_ESCAPE)
				)
			},
			apply() {
				const plistPath = path.join(
					os.homedir(),
					"Library/LaunchAgents/com.local.KeyRemapping.plist",
				)
				fs.mkdirSync(path.dirname(plistPath), {recursive: true})
				fs.writeFileSync(
					plistPath,
					`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.local.KeyRemapping</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/hidutil</string>
		<string>property</string>
		<string>--set</string>
		<string>{"UserKeyMapping":[{"HIDKeyboardModifierMappingSrc":${HID_KEY_CAPSLOCK},"HIDKeyboardModifierMappingDst":${HID_KEY_ESCAPE}}]}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>`,
				)
				execSync(`launchctl load ${plistPath}`)
			},
		},
		osxSetting({
			description: "Show hidden files in Finder",
			domain: "com.apple.finder",
			key: "AppleShowAllFiles",
			flag: "-bool",
			value: true,
			restartProcess: "Finder",
		}),
		osxSetting({
			description: "Show all filename extensions",
			domain: "NSGlobalDomain",
			key: "AppleShowAllExtensions",
			flag: "-bool",
			value: true,
			restartProcess: "Finder",
		}),
		osxSetting({
			description: "Finder: show path bar",
			domain: "com.apple.finder",
			key: "ShowPathbar",
			flag: "-bool",
			value: true,
			restartProcess: "Finder",
		}),
		osxSetting({
			description: "Finder: show status bar",
			domain: "com.apple.finder",
			key: "ShowStatusBar",
			flag: "-bool",
			value: true,
			restartProcess: "Finder",
		}),
		osxSetting({
			description: "Finder: use list view by default",
			domain: "com.apple.finder",
			key: "FXPreferredViewStyle",
			flag: "-string",
			value: "Nlsv",
			restartProcess: "Finder",
		}),
		osxSetting({
			description: "Finder: keep folders on top",
			domain: "com.apple.finder",
			key: "_FXSortFoldersFirst",
			flag: "-bool",
			value: true,
			restartProcess: "Finder",
		}),
		osxSetting({
			description: "Avoid creating .DS_Store files on network volumes",
			domain: "com.apple.desktopservices",
			key: "DSDontWriteNetworkStores",
			flag: "-bool",
			value: true,
		}),
		osxSetting({
			description: "Speed up Mission Control animations",
			domain: "com.apple.dock",
			key: "expose-animation-duration",
			flag: "-float",
			value: 0.1,
			restartProcess: "Dock",
		}),
		osxSetting({
			description: "Automatically hide and show the Dock",
			domain: "com.apple.dock",
			key: "autohide",
			flag: "-bool",
			value: true,
			restartProcess: "Dock",
		}),
		osxSetting({
			description: "Remove Dock auto-hide delay",
			domain: "com.apple.dock",
			key: "autohide-delay",
			flag: "-float",
			value: 0,
			restartProcess: "Dock",
		}),
		osxSetting({
			description: "Speed up Dock show/hide animation",
			domain: "com.apple.dock",
			key: "autohide-time-modifier",
			flag: "-float",
			value: 0.2,
			restartProcess: "Dock",
		}),
		osxSetting({
			description: "Disable Messages send sound",
			domain: "com.apple.iChat",
			key: "PlaySentSound",
			flag: "-bool",
			value: false,
		}),
		osxSetting({
			description: "Disable system bell/beep sound",
			domain: "NSGlobalDomain",
			key: "com.apple.sound.beep.volume",
			flag: "-float",
			value: 0,
		}),
		osxSetting({
			description: "Disable screenshot thumbnail preview",
			domain: "com.apple.screencapture",
			key: "show-thumbnail",
			flag: "-bool",
			value: false,
		}),
		{
			description: "Set screenshots location to ~/Screenshots",
			isApplied() {
				try {
					const current = cp
						.execSync(
							"defaults read com.apple.screencapture location",
							{
								encoding: "utf8",
								stdio: ["ignore", "pipe", "ignore"],
							},
						)
						.trim()
					return current === screenshotsDir
				} catch {
					return false
				}
			},
			apply() {
				fs.mkdirSync(screenshotsDir, {recursive: true})
				execSync(
					`defaults write com.apple.screencapture location "${screenshotsDir}"`,
				)
			},
		},
	]

	logger.info("ensureOSXSettings", "applying settings...")
	const processesToRestart = new Set<string>()
	for (const setting of settings) {
		if (setting.isApplied()) {
			logger.debug(
				"ensureOSXSettings",
				`already set: ${setting.description}`,
			)
		} else {
			logger.info("ensureOSXSettings", `applying: ${setting.description}`)
			setting.apply()
			if (setting.restartProcess) {
				processesToRestart.add(setting.restartProcess)
			}
		}
	}
	for (const proc of processesToRestart) {
		logger.info("ensureOSXSettings", `restarting ${proc}...`)
		try {
			cp.execSync(`killall ${proc}`, {stdio: "ignore"})
		} catch {
			// process may not be running
		}
	}
}

async function ensureDotFilesLinked(
	options: ProgramOptions,
	_ctx: SetupContext,
) {
	for (const name of fs.readdirSync(path.join(PROJECT_ROOT, "dotfiles"))) {
		if (!name.startsWith(".")) continue
		if (name === ".gitconfig") continue

		logger.debug("ensureDotFilesLinked", "ensure dotfile", {name})
		await ensureSymlink(
			{
				path: path.join(os.homedir(), name),
				target: path.join(PROJECT_ROOT, "dotfiles", name),
			},
			options,
		)
	}
}

async function ensureGitConfig(ctx: SetupContext) {
	const src = path.join(PROJECT_ROOT, "dotfiles", ".gitconfig")
	const dest = path.join(os.homedir(), ".gitconfig")

	let destStat: fs.Stats | null = null
	try {
		destStat = fs.lstatSync(dest)
	} catch {
		// dest doesn't exist
	}

	if (destStat !== null) {
		if (destStat.isSymbolicLink() && !fs.existsSync(dest)) {
			logger.info(
				"ensureGitConfig",
				"removing dangling .gitconfig symlink",
			)
			await fs.promises.rm(dest, {force: true})
		} else {
			logger.debug(
				"ensureGitConfig",
				".gitconfig already exists, skipping",
			)
			return
		}
	}

	if (!fs.existsSync(src)) {
		ctx.warnings.push(
			"dotfiles/.gitconfig not found; skipping gitconfig setup",
		)
		return
	}

	logger.info("ensureGitConfig", "copying .gitconfig to home directory")
	await fs.promises.copyFile(src, dest)
}

async function ensureConfigFilesLinked(
	options: ProgramOptions,
	_ctx: SetupContext,
) {
	const configs: Array<{name: string; path: string; target: string}> = [
		{
			name: "vscode/settings.json",
			path: path.join(
				os.homedir(),
				"Library/Application Support/Code/User/settings.json",
			),
			target: path.join(
				PROJECT_ROOT,
				"dotfiles/config/vscode/settings.json",
			),
		},
		{
			name: "zed/settings.json",
			path: path.join(os.homedir(), ".config/zed/settings.json"),
			target: path.join(
				PROJECT_ROOT,
				"dotfiles/config/zed/settings.json",
			),
		},
		{
			name: "zed/keymap.json",
			path: path.join(os.homedir(), ".config/zed/keymap.json"),
			target: path.join(PROJECT_ROOT, "dotfiles/config/zed/keymap.json"),
		},
	]
	for (const config of configs) {
		const result = await ensureSymlink(config, options)
		if (result === "already-linked") {
			logger.debug(
				"ensureConfigFilesLinked",
				`already linked: ${config.name}`,
			)
		} else {
			logger.info("ensureConfigFilesLinked", `linked: ${config.name}`)
		}
	}
}

async function ensureITermSettings(
	options: ProgramOptions,
	_ctx: SetupContext,
) {
	const name = "iterm2/com.googlecode.iterm2.plist"
	const result = await ensureSymlink(
		{
			path: path.join(
				os.homedir(),
				"Library/Preferences/com.googlecode.iterm2.plist",
			),
			target: path.join(
				PROJECT_ROOT,
				"dotfiles/config/iterm2/com.googlecode.iterm2.plist",
			),
		},
		options,
	)
	if (result === "already-linked") {
		logger.debug("ensureITermSettings", `already linked: ${name}`)
	} else {
		logger.info("ensureITermSettings", `linked: ${name}`)
	}
}

async function ensureSshSetup(_ctx: SetupContext) {
	const sshDir = path.join(os.homedir(), ".ssh")
	const keyPath = path.join(sshDir, "id_ed25519")

	fs.mkdirSync(sshDir, {recursive: true})
	fs.chmodSync(sshDir, 0o700)

	if (!fs.existsSync(keyPath)) {
		logger.info("ensureSshSetup", "generating ed25519 SSH key...")
		execSync(
			`ssh-keygen -t ed25519 -C "dvd.zkwsk@gmail.com" -N "" -f ${keyPath}`,
		)
		logger.info("ensureSshSetup", "SSH key generated", {keyPath})
	} else {
		logger.debug("ensureSshSetup", "SSH key already exists, skipping")
	}

	const configPath = path.join(sshDir, "config")
	const githubBlock = [
		"Host github.com",
		"  HostName github.com",
		"  User git",
		`  IdentityFile ${keyPath}`,
		"  AddKeysToAgent yes",
		"  IdentitiesOnly yes",
	].join("\n")

	let existing = ""
	if (fs.existsSync(configPath)) {
		existing = fs.readFileSync(configPath, "utf8")
	}
	if (existing.includes("Host github.com")) {
		logger.debug(
			"ensureSshSetup",
			"SSH config already has github.com entry, skipping",
		)
	} else {
		logger.info("ensureSshSetup", "adding github.com entry to SSH config")
		const separator =
			existing.length > 0 && !existing.endsWith("\n\n") ? "\n\n" : ""
		fs.writeFileSync(configPath, existing + separator + githubBlock + "\n")
		fs.chmodSync(configPath, 0o600)
	}
}

async function ensureNode(ctx: SetupContext) {
	if (commandExists("node")) {
		logger.debug("ensureNode", "node already installed, skipping")
		return
	}
	if (!commandExists("n")) {
		ctx.warnings.push(
			"Cannot install node: 'n' version manager is not installed",
		)
		return
	}
	logger.info("ensureNode", "installing Node.js LTS via n...")
	try {
		cp.execSync("n lts", {stdio: "inherit"})
	} catch (e) {
		const msg = `Failed to install Node.js: ${toError(e).message}`
		logger.warn("ensureNode", msg)
		ctx.warnings.push(msg)
	}
}

async function ensureSymlink(
	link: {path: string; target: string},
	options: {force: boolean},
): Promise<"created" | "already-linked"> {
	let stat: fs.Stats | null = null
	try {
		stat = fs.lstatSync(link.path)
	} catch {
		// path doesn't exist
	}
	if (stat !== null) {
		if (stat.isSymbolicLink()) {
			const linksTo = await fs.promises.readlink(link.path)
			if (linksTo === link.target) {
				return "already-linked"
			}
		}
		if (!options?.force) {
			throw logger.newError(
				"ensureSymlink",
				"a file already exists at the destination path. Use --force to override it.",
				link,
			)
		}
		logger.debug(
			"ensureSymlink",
			"(force) removing file so it can be re-created as a symlink.",
			link,
		)
		try {
			await fs.promises.rm(link.path, {force: true})
		} catch (e) {
			throw logger.newError(
				"ensureSymlink",
				"failed to remove existing file",
				{
					...link,
					error: e,
				},
			)
		}
	}
	try {
		fs.mkdirSync(path.dirname(link.path), {recursive: true})
		await fs.promises.symlink(link.target, link.path, "file")
	} catch (e) {
		throw logger.newError("ensureSymlink", "failed to create symlink", {
			...link,
			error: e,
		})
	}
	return "created"
}

function commandExists(command: string): boolean {
	try {
		cp.execSync(`which ${command}`, {stdio: "ignore"})
		return true
	} catch {
		return false
	}
}

function brewInstall(
	name: string,
	opts: {cask?: boolean; skipIfExists?: string[]},
	ctx: SetupContext,
) {
	if (opts.skipIfExists?.some((p) => fs.existsSync(p))) {
		logger.debug("brewInstall", `skip ${name}, already exists`)
		return
	}
	if (!opts.cask) {
		try {
			cp.execSync(`brew list --formula ${name}`, {stdio: "ignore"})
			logger.debug("brewInstall", `skip ${name}, already installed`)
			return
		} catch {
			// not installed, proceed
		}
	}
	try {
		cp.execSync(`brew install ${opts.cask ? "--cask " : ""}${name}`, {
			stdio: "inherit",
			timeout: 10 * 60 * 1000,
		})
	} catch (e) {
		const msg = `Failed to install ${name}: ${toError(e).message}`
		logger.warn("brewInstall", msg)
		ctx.warnings.push(msg)
	}
}

async function ensureCliApps(ctx: SetupContext) {
	logger.info("ensureCliApps", "installing CLI apps")
	brewInstall("coreutils", {}, ctx)
	brewInstall("gh", {}, ctx) // GitHub CLI
	brewInstall("git-extras", {}, ctx)
	brewInstall("zsh-completions", {}, ctx)

	brewInstall("n", {}, ctx) // node version manager
	if (commandExists("node")) {
		logger.debug("ensureCliApps", "node already installed, skipping")
	} else {
		if (!commandExists("n")) {
			ctx.warnings.push(
				"Cannot install node: 'n' version manager is not installed",
			)
		}
		logger.info("ensureCliApps", "installing Node.js LTS via n...")
		try {
			cp.execSync("n lts", {stdio: "inherit"})
		} catch (e) {
			const msg = `Failed to install Node.js: ${toError(e).message}`
			logger.warn("ensureCliApps", msg)
			ctx.warnings.push(msg)
		}
	}

	brewInstall("neovim", {}, ctx)
	brewInstall("jq", {}, ctx) // json explorer
	brewInstall("gron", {}, ctx) // json flattener
	brewInstall("tree", {}, ctx) // print nice file trees

	brewInstall("fzf", {}, ctx) // general purpose fuzzy-finder
	execSync(
		"$(brew --prefix)/opt/fzf/install --no-update-rc --key-bindings --completion",
	)

	brewInstall("htop", {}, ctx) // better `top`
	brewInstall("tldr", {}, ctx) // better `man`
	brewInstall("ripgrep", {}, ctx) // better `grep`
	brewInstall("fd", {}, ctx) // better `find`
	brewInstall("bat", {}, ctx) // better `cat`/`less`
	brewInstall("delta", {}, ctx) // better `git diff`
	brewInstall("lazygit", {}, ctx) // terminal git UI
	brewInstall("tig", {}, ctx) // terminal git browser
	brewInstall("pstree", {}, ctx) // `ps` as a tree
	brewInstall("up", {}, ctx) // write pipes with instant live preview
	brewInstall("watch", {}, ctx) // run command repeatedly
	brewInstall("mkcert", {}, ctx) // local HTTPS certs
	brewInstall("zoxide", {}, ctx) // better `cd`

	if (!commandExists("claude")) {
		logger.info("ensureCliApps", "installing Claude Code...")
		try {
			cp.execSync("npm install -g @anthropic-ai/claude-code", {
				stdio: "inherit",
			})
		} catch (e) {
			const msg = `Failed to install Claude Code: ${toError(e).message}`
			logger.warn("ensureCliApps", msg)
			ctx.warnings.push(msg)
		}
	}
}

async function ensureDesktopApps(ctx: SetupContext) {
	logger.info("ensureDesktopApps", "installing desktop apps")
	brewInstall(
		"iterm2",
		{cask: true, skipIfExists: ["/Applications/iTerm.app"]},
		ctx,
	)
	brewInstall(
		"ghostty",
		{cask: true, skipIfExists: ["/Applications/Ghostty.app"]},
		ctx,
	)
	brewInstall(
		"google-chrome",
		{cask: true, skipIfExists: ["/Applications/Google Chrome.app"]},
		ctx,
	)
	brewInstall(
		"cleanshot",
		{cask: true, skipIfExists: ["/Applications/CleanShot X.app"]},
		ctx,
	)
	brewInstall(
		"docker",
		{cask: true, skipIfExists: ["/Applications/Docker.app"]},
		ctx,
	)
	brewInstall(
		"slack",
		{cask: true, skipIfExists: ["/Applications/Slack.app"]},
		ctx,
	)
	brewInstall(
		"flux",
		{cask: true, skipIfExists: ["/Applications/Flux.app"]},
		ctx,
	)
	brewInstall(
		"visual-studio-code",
		{cask: true, skipIfExists: ["/Applications/Visual Studio Code.app"]},
		ctx,
	)
	brewInstall(
		"discord",
		{cask: true, skipIfExists: ["/Applications/Discord.app"]},
		ctx,
	)
	brewInstall(
		"raycast",
		{cask: true, skipIfExists: ["/Applications/Raycast.app"]},
		ctx,
	)
	brewInstall(
		"tableplus",
		{cask: true, skipIfExists: ["/Applications/TablePlus.app"]},
		ctx,
	)
	brewInstall(
		"dropbox",
		{cask: true, skipIfExists: ["/Applications/Dropbox.app"]},
		ctx,
	)
	brewInstall(
		"google-drive",
		{cask: true, skipIfExists: ["/Applications/Google Drive.app"]},
		ctx,
	)
	brewInstall(
		"1password",
		{
			cask: true,
			skipIfExists: [
				"/Applications/1Password.app",
				"/Applications/1Password 7 - Password Manager.app",
			],
		},
		ctx,
	)
}

async function ensureFonts(ctx: SetupContext) {
	logger.info("ensureFonts", "ensuring fonts...")
	// brewInstall("font-source-code-pro", {cask: true}, ctx)
	// brewInstall("font-hack-nerd-font", {cask: true}, ctx)
}

function execSync(command: string) {
	try {
		cp.execSync(command, {
			stdio: "inherit",
		})
	} catch (e) {
		throw logger.newError("execSync", "command failed", {command, error: e})
	}
}

createCliTool(import.meta, async () => {
	try {
		await ensureMacSetup()
	} catch (error) {
		logger.error("ensureMacSetup", "script failed", {error})
		process.exit(1)
	}
})
