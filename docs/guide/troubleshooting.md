# Troubleshooting

## The server works in Kumi but not in my app

- **Restart the app.** Claude Desktop only reads its config at startup. Other apps may need a new session or a reload.
- **Check the scope.** A project-scoped server only shows up when the app is opened in that folder. Pi reads project configs only after you trust the project.
- **Check the runtime.** Your app starts the server itself, with its own `PATH`. If it was opened from the Dock or a launcher, it may not see a runtime installed through nvm, asdf or similar. Using an absolute path for the command (a [custom server](./custom-servers)) works around this.
- **Bridged servers need Node.js.** Servers routed through `mcp-remote` run `npx -y mcp-remote …`, so `npx` must be available to the app.

## "…wasn't installed by Kumi"

There's already a server with that name in the config, and Kumi didn't put it there. Pick another server name, or on the review step tick **Replace existing servers with the same name that Kumi didn't install**. A backup is taken first.

## "The config file changed since the preview"

Something wrote the file between the preview and the install, often the app itself (Claude Code rewrites `~/.claude.json` regularly). Go back and review again; Kumi recomputes the edit against the new file.

## "This preview expired"

Previews are kept for 30 minutes. Review the changes again.

## "Refusing to write: the edit would change content outside this server entry"

A safety check stopped an edit that would have changed something other than the server. Your file was not touched. Please [open an issue](https://github.com/tvcsantos/kumi/issues) with the app and a copy of the config (with secrets removed).

## A config file shows an error in Installed

Kumi couldn't parse the file, usually because of a syntax error from a manual edit. Fix the file in an editor, or restore a backup from **Settings → Backups**. Kumi won't write to a file it can't parse.

## An app isn't detected

Kumi looks for the app's command on your `PATH` and for its config folder. If neither exists yet, the app shows as *not detected*, but you can still install into it; Kumi creates the config file.

If you keep an app's config somewhere else, set the variable the app uses (`CLAUDE_CONFIG_DIR`, `CODEX_HOME` or `XDG_CONFIG_HOME`) in your shell profile and restart Kumi. `PI_CODING_AGENT_DIR` is not read from the shell profile, so Kumi only sees it when it is launched from a terminal that has it set. See [Environment variables](../reference/environment).

## A registry won't save

Kumi checks a registry before saving it. The error says what went wrong:

- *No MCP Registry API found at …*: the URL doesn't serve `/servers`. Check the base URL; it usually ends in `/v0.1`.
- *The URL answered, but not like an MCP Registry*: the URL works, but isn't a registry. For a JSON file, choose **Static JSON file**.
- *401* or *403*: add or fix the registry's [headers](./registries#headers).
- *Secret headers can only be sent over https*: use an `https` URL.
- *Can't store secret headers securely*: the OS keychain isn't available. On Linux, make sure a Secret Service provider (GNOME Keyring, KWallet) is running.

## "Couldn't decrypt the secret headers"

The keychain entry Kumi used is gone, for example after moving to a new machine. Edit the registry and enter the secret values again.

## The macOS app "is damaged and can't be opened"

The build isn't notarized. See [Installation](./installation#macos).

## Starting fresh

Kumi keeps everything in its [data directory](../reference/data-directory). Quit Kumi and delete it to reset Kumi itself; your apps' config files are not affected.
