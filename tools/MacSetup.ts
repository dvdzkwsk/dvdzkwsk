import * as cp from "child_process"
import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import {Logger} from "../src/util/Logger.js"
import {execScript} from "./CliUtil.js"

const logger = new Logger("EnsureOSXSetup")

interface ProgramOptions {
	force: boolean
}

async function ensureMacSetup() {
	const options: ProgramOptions = {
		force: process.argv.includes("--force"),
	}

	await ensureOSXSettings()
	await ensureDotFilesLinked(options)
	await ensureConfigFilesLinked(options)
	await ensureHomebrew()
	await ensureApps()
	await ensureFonts()
}

async function ensureHomebrew() {
	if (!commandExists("brew")) {
		logger.info("ensureMacSetup", "installing homebrew...")
		execSync(
			'/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
		)
	}
}

async function ensureOSXSettings() {
	const commands: string[] = [
		// https://apple.stackexchange.com/questions/332769/macos-disable-popup-showing-accented-characters-when-holding-down-a-key
		"defaults write -g ApplePressAndHoldEnabled -bool false",

		// Disable smart quotes and dashes
		"defaults write NSGlobalDomain NSAutomaticQuoteSubstitutionEnabled -bool false",
		"defaults write NSGlobalDomain NSAutomaticDashSubstitutionEnabled -bool false",

		// Empty Trash securely by default
		"defaults write com.apple.finder EmptyTrashSecurely -bool true",

		// Show the ~/Library folder
		"chflags nohidden ~/Library",

		// Disable “natural” (Lion-style) scrolling
		"defaults write NSGlobalDomain com.apple.swipescrolldirection -bool false",

		// Enable full keyboard access for all controls (i.e. enable Tab in modal dialogs)
		"defaults write NSGlobalDomain AppleKeyboardUIMode -int 3",

		// Set a blazingly fast keyboard repeat rate
		"defaults write NSGlobalDomain ApplePressAndHoldEnabled -bool false",
		"defaults write NSGlobalDomain KeyRepeat -int 1",
		"defaults write NSGlobalDomain InitialKeyRepeat -int 12",

		// Show hidden files by default
		"Defaults write com.apple.finder AppleShowAllFiles -bool true",

		// Show all filename extensions
		"defaults write NSGlobalDomain AppleShowAllExtensions -bool true",

		// Avoid creating .DS_Store files on network volumes
		"defaults write com.apple.desktopservices DSDontWriteNetworkStores -bool true",

		// Set the icon size of Dock items to 36 pixels
		"defaults write com.apple.dock tilesize -int 36",

		// Speed up Mission Control animations
		"defaults write com.apple.dock expose-animation-duration -float 0.1",

		// Automatically hide and show the Dock
		"defaults write com.apple.dock autohide -bool true",
	]

	logger.info("ensureOSXSettings", "applying settings...")
	for (const cmd of commands) {
		console.debug(cmd)
		execSync(cmd)
	}
}

async function ensureDotFilesLinked(options: ProgramOptions) {
	for (const name of fs.readdirSync("dotfiles")) {
		if (!name.startsWith(".")) continue

		logger.debug("ensureDotFilesLinked", "ensure dotfile", {name})
		await ensureSymlink(
			{
				path: path.join(os.homedir(), name),
				target: path.join(process.cwd(), "dotfiles", name),
			},
			options,
		)
	}
}

async function ensureConfigFilesLinked(options: ProgramOptions) {
	logger.debug("ensureConfigFilesLinked", "ensure config file", {
		name: "vscode/settings.json",
	})
	await ensureSymlink(
		{
			path: path.join(
				os.homedir(),
				"Library/Application Support/Code/User/settings.json",
			),
			target: path.join(
				process.cwd(),
				"dotfiles/config/vscode/settings.json",
			),
		},
		options,
	)
	logger.debug("ensureConfigFilesLinked", "ensure config file", {
		name: "zed/settings.json",
	})
	await ensureSymlink(
		{
			path: path.join(os.homedir(), ".config/zed/settings.json"),
			target: path.join(
				process.cwd(),
				"dotfiles/config/zed/settings.json",
			),
		},
		options,
	)
	logger.debug("ensureConfigFilesLinked", "ensure config file", {
		name: "zed/keymap.json",
	})
	await ensureSymlink(
		{
			path: path.join(os.homedir(), ".config/zed/keymap.json"),
			target: path.join(process.cwd(), "dotfiles/config/zed/keymap.json"),
		},
		options,
	)
}

/**
 * Ensures a symlink exists at `src` and points to `dst`.
 */
async function ensureSymlink(
	link: {path: string; target: string},
	options: {force: boolean},
) {
	if (fs.existsSync(link.path)) {
		const stat = await fs.promises.lstat(link.path)
		if (stat.isSymbolicLink()) {
			const linksTo = await fs.promises.readlink(link.path)
			if (linksTo === link.target) {
				return
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
		logger.debug("ensureSymlink", "created symlink", link)
	} catch (e) {
		throw logger.newError("ensureSymlink", "failed to create symlink", {
			...link,
			error: e,
		})
	}
}

function commandExists(command: string): boolean {
	try {
		execSync(`which ${command}`)
		return true
	} catch (e) {
		return false
	}
}

async function ensureApps() {
	logger.info("ensureApps", "install homebrew apps")
	await doHomebrewInstall([
		{name: "coreutils"},
		{name: "hub"},
		{name: "git-extras"},
		{name: "zsh-completions"},
		{name: "nvim"}, // dark vim
		{name: "jq"}, // json explorer
		{name: "gron"}, // json flattener
		{name: "tree"}, // print nice file trees
		{name: "fasd"}, // easily jump to commonly-used directories
		{name: "fzf"}, // general purpose fuzzy-finder
		{name: "htop"}, // better `top`all
		{name: "tldr"}, // better `man`
		{name: "ripgrep"}, // better `grep`
		{name: "fd"}, // better `find`
		{name: "bat"}, // better `less` or `cat`
		{name: "tig"}, // better `git`
		{name: "diff-so-fancy"}, // better `git diff`
		{name: "pstree"}, // `ps` as a tree
		{name: "up"}, // write pipes with instant live preview
		{
			name: "iterm2",
			args: "--cask",
			skipIfExists: "/Applications/iTerm.app",
		},
		{
			name: "docker",
			args: "--cask",
			skipIfExists: "/Applications/Docker.app",
		},
		{
			name: "slack",
			args: "--cask",
			skipIfExists: "/Applications/Slack.app",
		},
		{name: "flux", args: "--cask", skipIfExists: "/Applications/Flux.app"},
	])
	execSync(
		"$(brew --prefix)/opt/fzf/install --no-update-rc --key-bindings --completion",
	)
}

async function ensureFonts() {
	logger.info("ensureFonts", "ensuring fonts...")
	await doHomebrewInstall([
		{name: "font-source-code-pro", args: "--cask"},
		{name: "font-hack-nerd-font", args: "--cask"},
	])
}

interface HomebrewPackage {
	name: string
	args?: string
	skipIfExists?: string
}
async function doHomebrewInstall(allPackages: HomebrewPackage[]) {
	const packagesToInstall = allPackages.filter((p) => {
		if (p.skipIfExists && fs.existsSync(p.skipIfExists)) {
			logger.debug(
				"doHomebrewInstall",
				"skip package because it already exists",
				{package: p},
			)
			return false
		}
		return true
	})
	const batched = packagesToInstall.filter((p) => !p.args)
	if (batched.length) {
		execSync(`brew install ${batched.map((p) => p.name).join(" ")}`)
	}
	const rest = packagesToInstall.filter((p) => p.args)
	for (const p of rest) {
		execSync(`brew install ${p.name} ${p.args}`)
	}
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

execScript(import.meta, async () => {
	try {
		await ensureMacSetup()
	} catch (error) {
		logger.error("ensureMacSetup", "script failed", {error})
		process.exit(1)
	}
})
