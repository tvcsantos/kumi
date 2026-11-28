# Supported apps

Kumi writes MCP servers into thirteen apps. This page lists, for each one, where its config lives, its format, and an example of what Kumi writes.

The examples install [Context7](https://context7.com) two ways: as a local npm package with an API key, and as a hosted server with an `Authorization` header.

## Overview

| App | Scopes | Format | Servers key |
|---|---|---|---|
| [Claude Desktop](#claude-desktop) | global | JSON | `mcpServers` |
| [Claude Code](#claude-code) | global, project, local | JSON | `mcpServers` |
| [VS Code (Copilot)](#vs-code-copilot) | global, workspace | JSONC | `servers` (+ `inputs`) |
| [Cursor](#cursor) | global, project | JSON | `mcpServers` |
| [OpenAI Codex](#openai-codex) | global | TOML | `[mcp_servers.<name>]` |
| [GitHub Copilot CLI](#github-copilot-cli) | global | JSON | `mcpServers` |
| [OpenCode](#opencode) | global, project | JSONC | `mcp.servers` |
| [Pi](#pi) | global, project | JSON | `mcpServers` |
| [Junie](#junie) | global, project | JSON | `mcpServers` |
| [Air in JetBrains IDEs](#air-in-jetbrains-ides) | global | JSON | `mcpServers` |
| [Zed](#zed) | global, project | JSONC | `context_servers` |
| [Cline](#cline) | global | JSON | `mcpServers` |
| [Hermes Agent](#hermes-agent) | global | YAML | `mcp_servers` |

## Transports

| App | stdio | Streamable HTTP | SSE |
|---|:-:|:-:|:-:|
| Claude Desktop | ✅ | via `mcp-remote` | via `mcp-remote` |
| Claude Code | ✅ | ✅ | ✅ |
| VS Code (Copilot) | ✅ | ✅ | ✅ |
| Cursor | ✅ | ✅ | ✅ |
| OpenAI Codex | ✅ | ✅ | via `mcp-remote` |
| GitHub Copilot CLI | ✅ | ✅ | ✅ |
| OpenCode | ✅ | ✅ | via `mcp-remote` |
| Pi | ✅ | ✅ | via `mcp-remote` |
| Junie | ✅ | ✅ | via `mcp-remote` |
| Air in JetBrains IDEs | ✅ | ✅ | via `mcp-remote` |
| Zed | ✅ | ✅ | via `mcp-remote` |
| Cline | ✅ | ✅ | ✅ |
| Hermes Agent | ✅ | ✅ | ✅ |

**via `mcp-remote`** means the app can't connect to that kind of server from its config file, so Kumi runs [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), a stdio bridge, in its place. Headers are passed through environment variables named `MCP_HEADER_<NAME>`, which `mcp-remote` expands itself, so values with spaces need no quoting. The bridge needs Node.js.

## Claude Desktop

| | |
|---|---|
| **Config** | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`<br>Windows: `%APPDATA%\Claude\claude_desktop_config.json`<br>Linux: `~/.config/Claude/claude_desktop_config.json` |
| **Detected by** | the config folder, or `Claude.app` (macOS), or `%LOCALAPPDATA%\AnthropicClaude` (Windows) |
| **Restart** | Required. Claude Desktop reads its config only at startup. |

::: code-group

```json [Local package]
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```json [Hosted (bridged)]
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://mcp.context7.com/mcp",
        "--transport", "http-only",
        "--header", "Authorization:${MCP_HEADER_AUTHORIZATION}"
      ],
      "env": { "MCP_HEADER_AUTHORIZATION": "Bearer …" }
    }
  }
}
```

:::

## Claude Code

| | |
|---|---|
| **Global** | `~/.claude.json`, top-level `mcpServers` (or `$CLAUDE_CONFIG_DIR/.claude.json`) |
| **Project** | `<project>/.mcp.json`, `mcpServers`. Shared through git. |
| **Local** | `~/.claude.json`, under `projects["<project path>"].mcpServers`. This project, only for you. |
| **Detected by** | `claude` on `PATH`, `~/.claude.json` or `~/.claude` |

`~/.claude.json` holds a lot of other Claude Code state, and Claude Code rewrites it often. Kumi only edits the server entry, and refuses to write if the file changed since the preview.

::: code-group

```json [Local package]
{
  "mcpServers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```json [Hosted]
{
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

:::

SSE servers are written with `"type": "sse"`.

## VS Code (Copilot)

| | |
|---|---|
| **Global** | macOS: `~/Library/Application Support/Code/User/mcp.json`<br>Windows: `%APPDATA%\Code\User\mcp.json`<br>Linux: `~/.config/Code/User/mcp.json` |
| **Workspace** | `<project>/.vscode/mcp.json` |
| **Detected by** | `code` on `PATH`, or the user folder |
| **Secure secrets** | Yes, with `inputs`. See [Secrets](../guide/secrets#vs-code-secure-storage). |

This is the config GitHub Copilot's agent mode uses in VS Code.

::: code-group

```jsonc [Local package]
{
  "servers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```jsonc [Hosted]
{
  "servers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

```jsonc [Hosted, secure secrets]
{
  "servers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "${input:kumi.context7.Authorization}" }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "kumi.context7.Authorization",
      "description": "Authorization (header) for MCP server \"context7\"",
      "password": true
    }
  ]
}
```

:::

## Cursor

| | |
|---|---|
| **Global** | `~/.cursor/mcp.json` |
| **Project** | `<project>/.cursor/mcp.json` |
| **Detected by** | `cursor` on `PATH`, `~/.cursor`, or `/Applications/Cursor.app` (macOS) |

Cursor tells Streamable HTTP and SSE apart from the server itself, so Kumi writes no `type`.

::: code-group

```json [Local package]
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```json [Hosted]
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

:::

## OpenAI Codex

| | |
|---|---|
| **Global** | `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) |
| **Detected by** | `codex` on `PATH`, or the Codex home folder |

Kumi owns the whole `[mcp_servers.<name>]` table, including sub-tables, and leaves the rest of the file byte for byte. Codex connects to Streamable HTTP servers directly; SSE servers go through `mcp-remote`.

::: code-group

```toml [Local package]
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp@4.4.4"]
env = { CONTEXT7_API_KEY = "…" }
```

```toml [Hosted]
[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
http_headers = { Authorization = "Bearer …" }
```

:::

## GitHub Copilot CLI

| | |
|---|---|
| **Global** | `~/.copilot/mcp-config.json` |
| **Detected by** | `copilot` on `PATH`, or `~/.copilot` |

This is the standalone Copilot CLI, separate from VS Code. Kumi enables all of the server's tools with `"tools": ["*"]`.

::: code-group

```json [Local package]
{
  "mcpServers": {
    "context7": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" },
      "tools": ["*"]
    }
  }
}
```

```json [Hosted]
{
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" },
      "tools": ["*"]
    }
  }
}
```

:::

## OpenCode

| | |
|---|---|
| **Global** | `~/.config/opencode/opencode.json` on every platform (follows `$XDG_CONFIG_HOME`) |
| **Project** | `<project>/opencode.json` |
| **Detected by** | `opencode` on `PATH`, or the config folder |

OpenCode takes the command and its arguments as one array, and environment variables under `environment`. Remote servers use Streamable HTTP only, so SSE servers go through `mcp-remote`.

::: code-group

```jsonc [Local package]
{
  "mcp": {
    "servers": {
      "context7": {
        "type": "local",
        "command": ["npx", "-y", "@upstash/context7-mcp@4.4.4"],
        "environment": { "CONTEXT7_API_KEY": "…" }
      }
    }
  }
}
```

```jsonc [Hosted]
{
  "mcp": {
    "servers": {
      "context7": {
        "type": "remote",
        "url": "https://mcp.context7.com/mcp",
        "headers": { "Authorization": "Bearer …" }
      }
    }
  }
}
```

:::

## Pi

| | |
|---|---|
| **Global** | `~/.pi/agent/mcp.json` (or `$PI_CODING_AGENT_DIR/mcp.json`) |
| **Project** | `<project>/.pi/mcp.json`. Pi reads it only after you trust the project. |
| **Detected by** | `pi` on `PATH`, or the agent folder |

Pi's built-in MCP support (Pi 0.99 and later) picks stdio when there's a `command` and Streamable HTTP when there's a `url`, so Kumi writes no `type`. Pi rejects the legacy SSE transport, so SSE servers go through `mcp-remote`.

::: code-group

```json [Local package]
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```json [Hosted]
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

:::

## Junie

| | |
|---|---|
| **Global** | `~/.junie/mcp/mcp.json` |
| **Project** | `<project>/.junie/mcp/mcp.json`. Junie loads it only for trusted projects. |
| **Detected by** | `junie` on `PATH`, or `~/.junie` |

JetBrains' Junie reads the same files from the Junie CLI and the Junie plugin in JetBrains IDEs, so one install covers both. An entry with a `command` runs locally and one with a `url` connects over HTTP, so Kumi writes no `type`. Junie doesn't document SSE, so SSE servers go through `mcp-remote`. Use `/mcp` in Junie to check or reconnect a server.

::: code-group

```json [Local package]
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```json [Hosted]
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

:::

## Air in JetBrains IDEs

| | |
|---|---|
| **Global** | `~/.jetbrains/mcp/mcp.json` (`%USERPROFILE%\.jetbrains\mcp\mcp.json` on Windows) |
| **Detected by** | `~/.jetbrains` |

This is the Air plugin inside JetBrains IDEs, not the standalone Air app. It reads one global file and has no project-level MCP file. An entry with a `command` runs locally and one with a `url` connects over HTTP, so Kumi writes no `type`. Air in IDEs doesn't support SSE, so SSE servers go through `mcp-remote`.

After installing, open **Settings | AI | Air | MCP Servers** in the IDE, refresh the list and tick the server to turn it on. The change applies to the next agent session you start.

::: code-group

```json [Local package]
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```json [Hosted]
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

:::

## Zed

| | |
|---|---|
| **Global** | macOS: `~/.config/zed/settings.json`<br>Linux: `~/.config/zed/settings.json` (follows `$XDG_CONFIG_HOME`)<br>Windows: `%APPDATA%\Zed\settings.json` |
| **Project** | `<project>/.zed/settings.json` |
| **Detected by** | `zed` on `PATH`, or the config folder, or `Zed.app` (macOS) |

Zed keeps MCP servers under `context_servers` in its main settings file, alongside every other setting; Kumi edits only its own entry and keeps your comments. An entry with a `command` runs locally and one with a `url` connects over Streamable HTTP, so Kumi writes no `type`. SSE servers go through `mcp-remote`.

Zed picks up the change without a restart; check **Settings | AI | MCP Servers** for a green dot. Servers in a project's `.zed/settings.json` only start once you trust that project.

::: code-group

```jsonc [Local package]
{
  "context_servers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```jsonc [Hosted]
{
  "context_servers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

:::

## Hermes Agent

| | |
|---|---|
| **Global** | `~/.hermes/config.yaml` (`%LOCALAPPDATA%\hermes\config.yaml` on Windows), or `$HERMES_HOME/config.yaml` |
| **Detected by** | `hermes` on `PATH`, or the Hermes home folder |

Nous Research's Hermes Agent keeps its MCP servers under `mcp_servers` in its YAML config, next to all its other settings. Kumi edits only the lines of the server's own entry and leaves the rest of the file byte for byte. It refuses to edit a file where `mcp_servers` is written as an inline `{ … }` mapping. Hermes has no project-level MCP file. Kumi writes the default profile's config. For a named profile, point `HERMES_HOME` at that profile's folder.

An entry with a `command` runs locally and one with a `url` connects over Streamable HTTP. SSE servers get `transport: sse`. Kumi doesn't wrap `npx` on Windows, because Hermes finds `npx.cmd` itself. The gateway picks up changes on its own; in a running `hermes` session, use `/reload-mcp`. Hermes-only fields such as `tools`, `enabled` or `auth: oauth` aren't managed by Kumi, and reinstalling a server from Kumi replaces its whole entry.

::: code-group

```yaml [Local package]
mcp_servers:
  context7:
    command: "npx"
    args: ["-y", "@upstash/context7-mcp@4.4.4"]
    env:
      CONTEXT7_API_KEY: "…"
```

```yaml [Hosted]
mcp_servers:
  context7:
    url: "https://mcp.context7.com/mcp"
    headers:
      Authorization: "Bearer …"
```

:::

## Windows

On Windows, `npx`, `npm`, `pnpm`, `pnpx`, `yarn` and `bunx` are `.cmd` shims that most apps can't start directly, so Kumi wraps them (except for Hermes Agent, which resolves them itself):

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@upstash/context7-mcp@4.4.4"]
}
```

## Coming later

Windsurf, Cline, Gemini CLI, Continue, and Copilot in JetBrains and Visual Studio are on the roadmap. Each app is one adapter; see [Adding an app](../contributing/adding-an-app).

## Cline

| | |
|---|---|
| **Global** | `~/.cline/data/settings/cline_mcp_settings.json` (`%USERPROFILE%\.cline\data\settings\cline_mcp_settings.json` on Windows). Moved by `$CLINE_MCP_SETTINGS_PATH` (the file itself), `$CLINE_DATA_DIR` (replaces `~/.cline/data`) or `$CLINE_DIR` (replaces `~/.cline`). |
| **Detected by** | `cline` on `PATH`, or `~/.cline` |

The Cline CLI and the Cline extension for VS Code share this file, so one install covers both. Older versions of the extension kept the file in VS Code's extension storage; current ones move those servers here. Cline has no project-level MCP file.

Kumi always writes `type`, because Cline reads a `url` without one as the legacy SSE transport: `stdio`, `streamableHttp` or `sse`. Cline watches the file and reconnects without a restart; check the **MCP Servers** view in the extension, or `cline mcp` in the CLI.

::: code-group

```json [Local package]
{
  "mcpServers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@4.4.4"],
      "env": { "CONTEXT7_API_KEY": "…" }
    }
  }
}
```

```json [Hosted]
{
  "mcpServers": {
    "context7": {
      "type": "streamableHttp",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

:::
