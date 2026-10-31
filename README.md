# Kumi 組

A desktop MCP marketplace. Browse MCP servers from the official [MCP Registry](https://registry.modelcontextprotocol.io), fill in their settings, and install them into the AI tools you use. Kumi writes the correct config, in the correct format and location, for each one.

| App | Scopes | Config |
|---|---|---|
| Claude Desktop | global | `claude_desktop_config.json` (remote servers via `mcp-remote`) |
| Claude Code | global, project (`.mcp.json`), local | `~/.claude.json` (honors `CLAUDE_CONFIG_DIR`) |
| VS Code (GitHub Copilot) | global, workspace (`.vscode/mcp.json`) | `mcp.json` (JSONC, optional secure `inputs`) |
| Cursor | global, project (`.cursor/mcp.json`) | `~/.cursor/mcp.json` |
| OpenAI Codex | global | `~/.codex/config.toml` (honors `CODEX_HOME`) |
| GitHub Copilot CLI | global | `~/.copilot/mcp-config.json` |

## Features

- **Catalog**: search the registry; featured servers; offline cache.
- **Generated install forms**: env vars, arguments, headers and URL variables come from each server's `server.json`. Secrets are masked.
- **Preview before writing**: a per-file diff of the exact edit. Secrets are hidden in the preview.
- **Safe edits**: comments, key order and unrelated settings are preserved. Writes are atomic, each file is backed up before every change (one-click restore), and a write is refused if the file changed after the preview or if the edit would touch anything outside the server entry.
- **Ownership tracking**: Kumi only updates or removes entries it created, unless you confirm.
- **Installed view**: every server in every app, including ones added by hand. Edit, remove, or add to more apps.
- **Test connection**: starts the server (or connects to it), runs the MCP handshake, and lists its tools.
- **Secrets**: written into the config by default, or kept in VS Code's secure storage. Values Kumi keeps for later edits are encrypted with the OS keychain.

## Development

```bash
npm install
npm run dev        # run the app with hot reload
npm test           # unit + integration tests
npm run typecheck
npm run dist       # package installers with electron-builder
npm run icon       # regenerate build/icon.png and build/icon.icns from build/icon.svg
```

Kumi stores its state, backups and cache in `~/.kumi` (override with `KUMI_DATA_DIR`).

To try the app without touching your real configs, point it at a throwaway home:

```bash
env -u CLAUDE_CONFIG_DIR -u CODEX_HOME HOME=/tmp/kumi-home KUMI_DATA_DIR=/tmp/kumi-home/.kumi npm run dev
```

## Layout

```
src/shared/      types, registry schema, variant → ServerSpec resolution (used by both processes)
src/main/        Electron main: client adapters, config I/O (JSON/JSONC/TOML), install planner,
                 registry client, backups, state, health check, IPC
src/preload/     the narrow `window.kumi` bridge
src/renderer/    React UI
tests/           Vitest suites with real-world config and registry fixtures
```

See [PLAN.md](PLAN.md) for the design and roadmap.
