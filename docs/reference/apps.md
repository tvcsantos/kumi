# Supported apps

Kumi writes MCP servers into eight apps. This page lists, for each one, where its config lives, its format, and an example of what Kumi writes.

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

## Windows

On Windows, `npx`, `npm`, `pnpm`, `pnpx`, `yarn` and `bunx` are `.cmd` shims that most apps can't start directly, so Kumi wraps them:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@upstash/context7-mcp@4.4.4"]
}
```

## Coming later

Windsurf, Zed, Cline, Gemini CLI, Continue, and Copilot in JetBrains and Visual Studio are on the roadmap. Each app is one adapter; see [Adding an app](../contributing/adding-an-app).
