#!/usr/bin/env npx tsx
import * as cp from "child_process"
import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import {execScript} from "./_util.js"
import {Logger} from "@pkg/logger/Logger.js"

const logger = new Logger("EnsureOSXSetup")

interface Options {
	force: boolean
}

async function ensureOSXSetup() {
	await ensureDependencies()

	const options: Options = {
		force: process.argv.includes("--force"),
	}

	if (process.argv.includes("--link")) {
		await ensureDotFilesLinked(options)
		await ensureConfigFilesLinked(options)
		return
	}

	await ensureOSXSettings()
	await ensureDotFilesLinked(options)
	await ensureConfigFilesLinked(options)
	await ensureApps()
	await ensureFonts()
}

async function ensureDependencies() {
	if (!commandExists("brew")) {
		logger.info("ensureDependencies", "installing homebrew...")
		cp.execSync(
			'/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
			{stdio: "inherit"},
		)
	}
	if (!commandExists("gum")) {
		logger.info("ensureHomebrew", "installing gum...")
		cp.execSync("brew install gum", {stdio: "inherit"})
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
		cp.execSync(cmd, {stdio: "inherit"})
	}
}

async function ensureDotFilesLinked(options: Options) {
	for (const name of fs.readdirSync("dotfiles")) {
		if (!name.startsWith(".")) continue

		logger.debug("ensureDotFilesLinked", "ensure dotfile", {name})
		await ensureSymlink(
			{
				from: path.join(os.homedir(), name),
				to: path.join(process.cwd(), "dotfiles", name),
			},
			options,
		)
	}
}

async function ensureConfigFilesLinked(options: Options) {
	logger.debug("ensureConfigFilesLinked", "ensure config file", {
		name: "vscode/settings.json",
	})
	await ensureSymlink(
		{
			from: path.join(
				os.homedir(),
				"Library/Application Support/Code/User/settings.json",
			),
			to: path.join(
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
			from: path.join(os.homedir(), ".config/zed/settings.json"),
			to: path.join(process.cwd(), "dotfiles/config/zed/settings.json"),
		},
		options,
	)
	logger.debug("ensureConfigFilesLinked", "ensure config file", {
		name: "zed/keymap.json",
	})
	await ensureSymlink(
		{
			from: path.join(os.homedir(), ".config/zed/keymap.json"),
			to: path.join(process.cwd(), "dotfiles/config/zed/keymap.json"),
		},
		options,
	)
}

/**
 * Ensures a symlink exists at `src` and points to `dst`.
 */
async function ensureSymlink(
	link: {from: string; to: string},
	options: {force: boolean},
) {
	if (fs.existsSync(link.from)) {
		const stat = await fs.promises.lstat(link.from)
		if (stat.isSymbolicLink()) {
			const linksTo = await fs.promises.readlink(link.from)
			if (linksTo === link.to) {
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
			await fs.promises.rm(link.from, {force: true})
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
		await fs.promises.symlink(link.to, link.from, "file")
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
		cp.execSync(`which ${command}`)
		return true
	} catch (e) {
		return false
	}
}

async function ensureApps() {
	logger.info("ensureApps", "install homebrew apps")
	await doHomebrewInstall([
		"brew tap homebrew/cask-versions",
		"brew install coreutils",
		"brew install hub",
		"brew install git-extras",
		"brew install zsh-completions",
		"brew install nvim", // dark vim
		"brew install jq", // json explorer
		"brew install gron", // json flattener
		"brew install tree", // print nice file trees
		"brew install fasd", // easily jump to commonly-used directories
		"brew install fzf", // general purpose fuzzy-finder
		"brew install htop", // better `top`all
		"brew install tldr", // better `man`
		"brew install ripgrep", // better `grep`
		"brew install fd", // better `find`
		"brew install bat ", // better `less` or `cat`
		"brew install tig", // better `git`
		"brew install diff-so-fancy", // better `git diff`
		"brew install pstree", // `ps` as a tree
		"brew install up", // write pipes with instant live preview
		"brew install iterm2 --cask",
		"brew install docker --cask",
		"brew install slack --cask",
		"brew install flux --cask",
	])
	cp.execSync("$(brew --prefix)/opt/fzf/install", {stdio: "inherit"})
}

async function ensureFonts() {
	logger.info("ensureFonts", "ensuring fonts...")
	await doHomebrewInstall([
		"brew tap homebrew/cask-fonts",
		"brew install font-source-code-pro --cask",
		"brew install font-hack-nerd-font --cask",
	])
}

async function doHomebrewInstall(commands: string[]) {
	const taps: string[] = []
	const apps: string[] = []
	const casks: string[] = []
	for (const cmd of commands) {
		if (cmd.includes("brew tap")) {
			taps.push(cmd.split(" ")[2])
		} else if (cmd.includes("--cask")) {
			casks.push(cmd.split(" ")[2])
		} else {
			apps.push(cmd.split(" ")[2])
		}
	}
	if (taps.length) {
		cp.execSync(`brew tap ${taps.join(" ")}`, {stdio: "inherit"})
	}
	if (apps.length) {
		cp.execSync(`brew install ${apps.join(" ")}`, {stdio: "inherit"})
	}
	if (casks.length) {
		for (const cask of casks) {
			try {
				cp.execSync(`brew install ${cask} --cask`, {
					stdio: "inherit",
				})
			} catch (e) {}
		}
	}
}

execScript(import.meta, ensureOSXSetup)
