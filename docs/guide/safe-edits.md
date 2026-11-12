# How Kumi edits configs

Your config files hold settings you tuned by hand, and some of them, like `~/.claude.json`, hold a lot of unrelated app state. Kumi is built so that installing a server never costs you anything else.

## Only the server entry changes

Kumi never regenerates a file. It parses it, changes the one server entry, and writes the result:

- **JSON and JSONC** (Claude, VS Code, Cursor, Copilot CLI, OpenCode, Pi) are edited in place with [`jsonc-parser`](https://github.com/microsoft/node-jsonc-parser). Comments, key order and unrelated settings are kept. Lines right next to the edit may be reformatted.
- **TOML** (Codex) is edited by section. Kumi owns the whole `[mcp_servers.<name>]` table and leaves the rest of the file byte for byte.

After computing an edit, Kumi parses the file before and after and compares everything except the server entry. If anything else would change, it refuses to write:

> Refusing to write: the edit would change content outside this server entry.

## Preview, then write exactly that

The review step shows the diff Kumi computed. When you click **Install**, Kumi writes exactly that text, and only if the file is still the one it previewed. It records a hash of each file at preview time and checks it again right before writing:

> The config file changed since the preview. Review the changes again.

## Atomic writes

Each file is written to a temporary file in the same folder, flushed to disk, then renamed over the original. A crash or power cut leaves either the old file or the new one, never half of each. The file's permissions are kept.

After writing, Kumi reads the file back and checks the server is there.

## Backups

Every write is preceded by a backup of the file, including a note when the file didn't exist yet. You can restore any backup from **Settings → Backups**; restoring backs up the current file first. Kumi keeps the last 20 backups of each file. See [Backups](./installed#backups).

## Ownership

Kumi records each entry it creates: app, scope, config file and name. With that record:

- It updates and removes its own entries freely.
- It lists entries you added by hand, but asks before replacing or removing them.
- An entry with the same name that Kumi didn't create blocks the install until you rename yours or confirm the replacement.

## Platform details

- **Windows**: `npx`, `npm`, `pnpm`, `pnpx`, `yarn` and `bunx` are `.cmd` shims that most apps can't start directly, so Kumi writes them as `cmd /c npx …`.
- **macOS and Linux**: apps opened from the Dock or a launcher don't see your shell's `PATH` or variables like `CLAUDE_CONFIG_DIR`. Kumi reads them from your login shell at startup, so it finds the same files and commands a terminal would.
