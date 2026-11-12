# Environment variables

## Kumi

### `KUMI_DATA_DIR`

Where Kumi keeps its state, backups and cache. Default: `~/.kumi`. See [Data directory](./data-directory).

## App config locations

Some apps let you move their config with an environment variable. Kumi follows the same variables, so it reads and writes the files the app actually uses.

| Variable | App | Effect |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | Claude Code | Global config is `$CLAUDE_CONFIG_DIR/.claude.json` instead of `~/.claude.json`. |
| `CODEX_HOME` | OpenAI Codex | Config is `$CODEX_HOME/config.toml` instead of `~/.codex/config.toml`. |
| `XDG_CONFIG_HOME` | OpenCode; on Linux also Claude Desktop and VS Code | Replaces `~/.config`. |
| `PI_CODING_AGENT_DIR` | Pi | Global config is `$PI_CODING_AGENT_DIR/mcp.json` instead of `~/.pi/agent/mcp.json`. |
| `APPDATA`, `LOCALAPPDATA` | Windows | Where Claude Desktop and VS Code keep their config, and where Claude Desktop is detected. |

## Your login shell

Apps opened from the Dock, Finder or a desktop launcher on macOS and Linux start with a minimal environment: no `PATH` additions from nvm, Homebrew or asdf, and none of the variables you export in your shell profile.

So at startup Kumi asks your login shell (`$SHELL -ilc`, falling back to `/bin/zsh`) for:

- `PATH`, merged with the one Kumi started with, to find `npx`, `uvx`, `docker`, `dnx` and the app commands it uses for detection;
- `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `XDG_CONFIG_HOME`, if Kumi didn't already have them.

This takes at most five seconds, and the window opens while it runs. On Windows, GUI apps already see the user's environment, so this step is skipped.

`PI_CODING_AGENT_DIR` isn't read from the shell. Set it in Kumi's own environment, for example by starting Kumi from a terminal that has it.

## Trying Kumi without touching your configs

Point Kumi at a throwaway home and data directory. This is mostly useful for development:

```bash
env -u CLAUDE_CONFIG_DIR -u CODEX_HOME -u XDG_CONFIG_HOME -u PI_CODING_AGENT_DIR \
  HOME=/tmp/kumi-home KUMI_DATA_DIR=/tmp/kumi-home/.kumi npm run dev
```
