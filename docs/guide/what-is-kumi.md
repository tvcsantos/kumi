# What is Kumi?

Kumi is a desktop app for finding [MCP](https://modelcontextprotocol.io) servers and adding them to the AI tools you use. You pick a server, fill in its settings once, choose your apps, and Kumi writes the correct config for each one, in that app's format and location.

> *Kumi* (組) means "group" or "set", and also "to braid", as in *kumihimo*, braided cord. Kumi gathers your MCP servers into one set and weaves it into every tool you use.

## The problem

Every AI app reads MCP servers from its own config file, and no two agree on the details:

- Claude Desktop, Claude Code, Cursor, Copilot CLI and Pi use `mcpServers`, VS Code uses `servers`, OpenCode uses `mcp.servers`, and Codex uses a TOML table, `[mcp_servers.<name>]`.
- Some need a `type` field and some don't. Some can reach remote servers directly and some can't.
- Files live in different places on macOS, Windows and Linux, and some apps also have project-level files.
- Many of these files hold other settings you tuned by hand, and a careless edit can break them.

Setting up one server in four apps means four different edits. Kumi does them for you.

## What Kumi does

1. **Browse** servers from the official [MCP Registry](https://registry.modelcontextprotocol.io) and any registry you add, including private ones. See [Discover servers](./discover).
2. **Configure** them with a form generated from the server's `server.json`: environment variables, arguments, headers and URL variables. See [Install a server](./install).
3. **Install** into several apps at once, globally or for one project, after reviewing a diff of every file it will change.
4. **Manage** everything from one list: every server in every app, including the ones you added by hand. Edit, remove, add to more apps, or restore a backup. See [Manage installed servers](./installed).
5. **Test** a server: Kumi runs the MCP handshake and lists its tools. See [Test a connection](./test-connection).

## What Kumi doesn't do

- **It doesn't run your servers.** Your apps start and talk to MCP servers as usual. Kumi only writes their configuration. (The one exception is [Test connection](./test-connection), which starts a server briefly when you ask.)
- **It doesn't host a registry.** It reads the official MCP Registry and the registries you add.
- **It doesn't touch what it doesn't own** without asking. Servers you added by hand are listed, but Kumi asks before changing or removing them. See [How Kumi edits configs](./safe-edits).

## Supported apps

| App | Scopes |
|---|---|
| Claude Desktop | global |
| Claude Code | global, project, local |
| VS Code (GitHub Copilot) | global, workspace |
| Cursor | global, project |
| OpenAI Codex | global |
| GitHub Copilot CLI | global |
| OpenCode | global, project |
| Pi | global, project |

The [Supported apps](../reference/apps) reference lists each app's config file, format and transports, with an example of what Kumi writes.

## Next steps

- [Install Kumi](./installation)
- [Walk through the first run](./first-run)
