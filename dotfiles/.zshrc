# Enable for profiling ZSH performance
# zmodload zsh/zprof

# Main Settings -------------------------------------------- {{{
set -o vi                             # Allow vi-like commands in bash
ulimit -n 2000                        # Increase allowed open file limit
export HISTFILE=~/.histfile           # Where to save command history
export HISTSIZE=500                   # Increase the default history size
export SAVEHIST=500                   # ibid
export HISTCONTROL=erasedups          # Remove duplicates in history
export VISUAL=nvim                    # Global default editor
export EDITOR="$VISUAL"               # ibid
export GPG_TTY=$(tty)
#}}}

# ZSH Settings --------------------------------------------- {{{
setopt sharehistory           # Share history across terminals
setopt appendhistory          # Persist history across sessions
setopt incappendhistory       # Immediately append to history file

autoload -U edit-command-line
autoload -U zmv

# Load zsh completions
fpath=(/usr/local/share/zsh-completions $fpath)

# Make history work as expected
alias history="history 1"

# Prompt
eval "$(starship init zsh)"

# Mirror bash's Ctrl + x + e functionality to edit the current command with $EDITOR.
# http://nuclearsquid.com/writings/edit-long-commands/
zle -N edit-command-line
bindkey '^xe' edit-command-line
bindkey '^x^e' edit-command-line
bindkey -M vicmd v edit-command-line
bindkey '^R' history-incremental-search-backward
#}}}

# Fasd ----------------------------------------------------- {{{
eval "$(fasd --init auto)"
#}}}

# FZF ------------------------------------------------------ {{{
# respect .gitignore
export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
#}}}

# Git ------------------------------------------------------ {{{
eval "$(hub alias -s)"

# [g]it [b]ranch [d]elete
# Delete a branchs, just like "git branch -D" if a branch name is provided.
# With no branch provided, displays a list of all local branches to pick from
# (can pick multiple).
function gbd {
  if [ -n "$1" ]; then
    git branch -D "$@"
  else
    git branch -D $(git branch -l | fzf -m | tr -s " " | sed 's/ //g')
  fi
}

# [g]it [c]heck[o]ut
# Checks out a local branch, just like "git checkout" if a branch name is
# provided. With no branch provided, displays a list of all local branches
# to pick from.
function gco {
  if [ -n "$1" ]; then
    git checkout "$@"
  else
    git checkout $(git branch -l | fzf | sed 's/ //g')
  fi
}

# [g]it [c]heck[o]ut [r]emote
# Presents a list of remote branches and checks out the selection.
function gcor {
  git checkout $(git branch -r | sed 's/.*origin\///g' | fzf | sed 's/ //g')
}

# [g]it [r]eset [o]rigin [h]ard!
# Forcibly resets the current branch to what's been pushed to the origin.
function groh! {
  git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)
}
#}}}

# Go ------------------------------------------------------- {{{
export GOPATH="$HOME/go"
export PATH=$GOPATH/bin:$PATH
#}}}

# Node ----------------------------------------------------- {{{
export N_PREFIX="$HOME/.n"
export PATH=$N_PREFIX/bin:$PATH
export PATH=$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
#}}}

# Postgres ------------------------------------------------- {{{
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"

# For compilers to find postgresql@15 you may need to set:
# export LDFLAGS="-L/opt/homebrew/opt/postgresql@15/lib"
# export CPPFLAGS="-I/opt/homebrew/opt/postgresql@15/include"
#}}}

# Ripgrep -------------------------------------------------- {{{
export RIPGREP_CONFIG_PATH="$HOME/.ripgreprc"
#}}}

# Rust ----------------------------------------------------- {{{
export PATH=$HOME/.cargo/bin:$PATH
#}}}

# Aliases -------------------------------------------------- {{{
alias afk="/System/Library/CoreServices/Menu\ Extras/User.menu/Contents/Resources/CGSession -suspend"
alias size="stat -f%z"
alias weather="curl wttr.in"
alias diff="colordiff"
alias cat="bat"
alias plan="$EDITOR ~/Workspace/docs/plan.txt"
alias t="$EDITOR ~/Workspace/docs/triage.txt"
alias q="quilt"

function snapshot {
	cd ~/Workspace
	git add .
	git commit -m "Snapshot"
	git push
}

# [F]ind
function ff {
  local files
  files=$(fzf --preview 'bat --style=numbers --color=always {} | head -500' "$@")
  [[ -n "$files" ]] && ${EDITOR:-vim} "${files[@]}"
}

# [H]istory
function h {
  $(history | cut -d' ' -f5- | awk '!x[$0]++' | fzf)
}

# [L]ist
alias ll="ls -la -Gfh"
alias ls="ls -Gfh"

# [V]im
alias vrc="$EDITOR ~/.config/nvim/init.vim"

# [Z]sh
alias zrc="$EDITOR ~/.zshrc"
alias zrcs="source ~/.zshrc"
#}}}

# Externals ------------------------------------------------ {{{
[ -f ~/.zshrc_local ] && source ~/.zshrc_local
#}}}

# Enable for profiling ZSH performance
# zprof

# bun completions
[ -s "/Users/davezuko/.bun/_bun" ] && source "/Users/davezuko/.bun/_bun"
