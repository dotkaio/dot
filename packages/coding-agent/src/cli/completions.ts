/**
 * Shell completion support for the CLI.
 *
 * `dot completion zsh` prints a zsh completion script that can be stored as
 * `_dot` in a directory on zsh's fpath (before compinit runs) or evaluated
 * directly in a zsh session with eval "$(dot completion zsh)".
 */

import { APP_NAME } from "../config.ts";

const ZSH_COMPLETION_SCRIPT = `#compdef dot

# zsh completion for the dot CLI
# Regenerate with: dot completion zsh > <dir-on-fpath>/_dot

_dot() {
	local -a subcommands
	subcommands=(
		'install:Install extension source and add to settings'
		'remove:Remove extension source from settings'
		'uninstall:Remove extension source from settings (alias for remove)'
		'update:Update dot, installed packages, or model catalogs'
		'list:List installed extensions'
		'config:Open TUI to enable or disable package resources'
		'auth:Print credentials for external clients'
		'completion:Print shell completion script'
	)

	local -a global_options
	global_options=(
		'(--help -h)'{-h,--help}'[Show help]'
		'(--version -v)'{-v,--version}'[Show version number]'
		'(--print -p)'{-p,--print}'[Non-interactive mode: process prompt and exit]'
		'(--continue -c)'{-c,--continue}'[Continue previous session]'
		'(--resume -r)'{-r,--resume}'[Select a session to resume]'
		'(--session)'--session='[Use specific session file or partial UUID]:session:_dot_session_files'
		'(--session-id)'--session-id='[Use exact project session ID]:id:'
		'(--fork)'--fork='[Fork specific session file or partial UUID]:session:_dot_session_files'
		'(--session-dir)'--session-dir='[Session storage directory]:dir:_directories'
		'--no-session[Do not save session]'
		'(--name -n)'{-n,--name}'[Set session display name]:name:'
		'(--provider)'--provider='[Provider name]:provider:'
		'(--model)'--model='[Model pattern or ID]:model:'
		'(--api-key)'--api-key='[API key]:key:'
		'(--system-prompt)'--system-prompt='[System prompt text]:text:'
		'--append-system-prompt=[Append text to the system prompt (repeatable)]:text:'
		'(--mode)'--mode='[Output mode]:mode:(text json rpc)'
		'(--models)'--models='[Model patterns for model cycling]:patterns:'
		'(--tools -t)'{-t,--tools}'[Tool allowlist (comma-separated)]:tools:_dot_tools'
		'(--exclude-tools -xt)'{-xt,--exclude-tools}'[Tool denylist (comma-separated)]:tools:_dot_tools'
		'(--no-tools -nt)'{-nt,--no-tools}'[Disable all tools]'
		'(--no-builtin-tools -nbt)'{-nbt,--no-builtin-tools}'[Disable built-in tools, keep extension tools]'
		'(--thinking)'--thinking='[Thinking level]:level:(off minimal low medium high xhigh max)'
		'(-e --extension *)--extension=[Load extension file (repeatable)]:file:_files'
		'(-e --extension *)-e[Load extension file (repeatable)]:file:_files'
		'(--no-extensions -ne)'{-ne,--no-extensions}'[Disable extension discovery]'
		'--skill=[Load skill file or directory (repeatable)]:file:_files -/'
		'(--no-skills -ns)'{-ns,--no-skills}'[Disable skills discovery]'
		'--prompt-template=[Load prompt template file or directory (repeatable)]:file:_files -/'
		'(--no-prompt-templates -np)'{-np,--no-prompt-templates}'[Disable prompt template discovery]'
		'--theme=[Load theme file or directory (repeatable)]:file:_files -/'
		'--no-themes[Disable theme discovery and loading]'
		'(--no-context-files -nc)'{-nc,--no-context-files}'[Disable AGENTS.md and CLAUDE.md discovery]'
		'(--export)'--export='[Export session file to HTML and exit]:file:_files'
		'--list-models[List available models]::search:'
		'--verbose[Force verbose startup]'
		'(--ui-mode)--ui-mode=[UI mode]:mode:(regular fullscreen)'
		'--alt[Use fullscreen UI mode]'
		'(--approve -a)'{-a,--approve}'[Trust project-local files for this run]'
		'(--no-approve -na)'{-na,--no-approve}'[Ignore project-local files for this run]'
		'--offline[Disable startup network operations]'
	)

	_arguments -C -S "\${global_options[@]}" \\
		'1:subcommand:->subcommand' \\
		'*::argument:->argument'

	case $state in
		subcommand)
			_describe -t subcommands 'subcommand' subcommands
			;;
		argument)
			case $words[1] in
				install)
					_dot_install
					;;
				remove|uninstall)
					_dot_remove
					;;
				update)
					_dot_update
					;;
				list)
					_dot_list
					;;
				config)
					_dot_config
					;;
				auth)
					_dot_auth
					;;
				completion)
					_dot_completion
					;;
			esac
			;;
	esac
}

_dot_install() {
	_arguments -S \\
		'(--local -l)'{-l,--local}'[Install project-locally]' \\
		'(--approve -a)'{-a,--approve}'[Trust project-local files for this command]' \\
		'(--no-approve -na)'{-na,--no-approve}'[Ignore project-local files for this command]' \\
		'(--help -h)'{-h,--help}'[Show help]' \\
		'1:source:_files -/'
}

_dot_remove() {
	_arguments -S \\
		'(--local -l)'{-l,--local}'[Remove from project settings]' \\
		'(--approve -a)'{-a,--approve}'[Trust project-local files for this command]' \\
		'(--no-approve -na)'{-na,--no-approve}'[Ignore project-local files for this command]' \\
		'(--help -h)'{-h,--help}'[Show help]' \\
		'1:source:'
}

_dot_update() {
	_arguments -S \\
		'(--self --extensions --models --all)--self[Update dot only]' \\
		'(--self --extensions --models --all)--extensions[Update installed packages only]' \\
		'(--self --extensions --models --all)--models[Refresh model catalogs only]' \\
		'(--self --extensions --models --all)--all[Update dot and installed packages]' \\
		'(--extension)'--extension='[Update one package only]:source:' \\
		'(--approve -a)'{-a,--approve}'[Trust project-local files for this command]' \\
		'(--no-approve -na)'{-na,--no-approve}'[Ignore project-local files for this command]' \\
		'--force[Reinstall dot even if the current version is latest]' \\
		'(--help -h)'{-h,--help}'[Show help]' \\
		'1:target:(self dot)'
}

_dot_list() {
	_arguments -S \\
		'(--approve -a)'{-a,--approve}'[Trust project-local files for this command]' \\
		'(--no-approve -na)'{-na,--no-approve}'[Ignore project-local files for this command]' \\
		'(--help -h)'{-h,--help}'[Show help]'
}

_dot_config() {
	_arguments -S \\
		'(--local -l)'{-l,--local}'[Edit project overrides]' \\
		'(--approve -a)'{-a,--approve}'[Trust project-local files for this command]' \\
		'(--no-approve -na)'{-na,--no-approve}'[Ignore project-local files for this command]' \\
		'(--help -h)'{-h,--help}'[Show help]'
}

_dot_auth() {
	local -a commands
	commands=(
		'print-api-key:Print a provider API key'
		'print-bearer-token:Print an OAuth bearer token'
	)

	_arguments -C -S \\
		'1:command:->command' \\
		'*::argument:->argument'

	case $state in
		command)
			_describe -t commands 'command' commands
			;;
		argument)
			case $words[1] in
				print-api-key)
					_dot_auth_print_api_key
					;;
				print-bearer-token)
					_dot_auth_print_bearer_token
					;;
			esac
			;;
	esac
}

_dot_auth_print_api_key() {
	_arguments -S \\
		'(--provider)--provider=[Provider name]:provider:' \\
		'(--model)--model=[Model pattern or ID]:model:' \\
		'(--help -h)'{-h,--help}'[Show help]'
}

_dot_auth_print_bearer_token() {
	_arguments -S \\
		'(--provider)--provider=[Provider name]:provider:' \\
		'(--model)--model=[Model pattern or ID]:model:' \\
		'(--min-expiry)--min-expiry=[Minimum remaining token lifetime]:duration:' \\
		'(--help -h)'{-h,--help}'[Show help]'
}

_dot_completion() {
	_arguments -S \\
		'(-h --help)'{-h,--help}'[Show help]' \\
		'1:shell:(zsh)'
}

_dot_tools() {
	_values -s , read bash edit write grep find ls
}

_dot_session_files() {
	local dir="$DOT_CODING_AGENT_SESSION_DIR"
	if [[ -z "$dir" ]]; then
		dir="$DOT_CODING_AGENT_DIR"
		if [[ -z "$dir" ]]; then
			dir="$HOME/.dot/agent"
		fi
		dir="$dir/sessions"
	fi
	_files -W "$dir" -g '*.jsonl(N-.)'
}

if (( $+functions[compdef] )); then
	compdef _dot dot
fi

if [ "$funcstack[1]" = "_dot" ]; then
	_dot
fi
`;

export function getZshCompletion(appName: string): string {
	return ZSH_COMPLETION_SCRIPT.replaceAll("_dot", `_${appName}`).replaceAll("dot", appName);
}

function printCompletionHelp(): void {
	console.log(`Usage: ${APP_NAME} completion <shell>

Print a shell completion script.

Shells:
  zsh    Print the zsh completion script

Install (zsh):
  mkdir -p ~/.zfunc && ${APP_NAME} completion zsh > ~/.zfunc/_dot
  # then add fpath=(~/.zfunc $fpath) before compinit in ~/.zshrc`);
}

export function handleCompletionCommand(args: string[]): boolean {
	const command = args[0];
	if (command !== "completion") {
		return false;
	}

	const shell = args[1];
	if (shell === undefined || shell === "-h" || shell === "--help") {
		printCompletionHelp();
		process.exit(process.exitCode ?? 0);
		return true;
	}

	if (shell !== "zsh") {
		console.error(`Error: unsupported shell "${shell}". Supported shells: zsh`);
		process.exit(1);
		return true;
	}

	process.stdout.write(getZshCompletion(APP_NAME));
	process.exit(process.exitCode ?? 0);
	return true;
}
