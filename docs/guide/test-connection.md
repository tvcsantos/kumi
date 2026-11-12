# Test a connection

**Test connection** checks that a server actually works before you rely on it. It's available in the install wizard (on the configure step and after installing) and on every server in [Installed](./installed).

## What it does

For a **local** server, Kumi starts the command with the settings you entered, the same way your apps will, runs the MCP `initialize` handshake, asks for the list of tools, and stops the server.

For a **remote** server, Kumi connects to the URL with your headers over Streamable HTTP. If the server answers `404` or `405`, it retries with the older SSE transport.

The result shows:

- the server's name and version, as it reports them;
- the tools it exposes, with their descriptions;
- how long it took;
- on failure, the error with a hint, and the server's stderr output.

::: warning It runs the server's code
Testing a local server runs third-party code on your machine with your permissions, just like your AI apps do when they start it. Only test servers you trust.
:::

## Servers that sign in with OAuth

Many hosted servers (Notion, for example) don't take an API key. They use MCP's OAuth sign-in instead. If such a server answers `401` and you haven't set an `Authorization` header, Kumi:

1. finds the server's authorization server and registers itself as a client;
2. opens the sign-in page in your browser;
3. waits up to 5 minutes for you to approve, catching the redirect on `http://127.0.0.1:<port>/callback`;
4. connects again with the new token and lists the tools.

Kumi keeps the token in memory until you quit, so testing again doesn't ask you to sign in. It isn't saved to disk or shared with your apps: each app signs in on its own the first time it uses the server.

If you set an `Authorization` header, Kumi sends only that header and skips OAuth.

A server can only do this if it supports dynamic client registration. Servers that need a pre-registered app, or that answer with something other than `401` (GitHub's hosted server, for example), still need a token in the `Authorization` header.

## Timeouts

The first run of an `npx`, `uvx` or `docker` server may download the package or image, so Kumi waits up to 90 seconds for the handshake, then up to 30 seconds for the tool list.

## Common errors

| Error | What to check |
|---|---|
| *Is the command installed and on your PATH?* | The runtime (`npx`, `uvx`, `docker`, …) isn't installed, or isn't on your shell's `PATH`. **Settings → Runtimes** shows what Kumi found. |
| *Check your API key or token.* | The server answered `401 Unauthorized`. |
| *Sign-in failed: …* | You declined in the browser, or the authorization server returned an error. |
| *Sign-in timed out after 5 minutes* | The browser sign-in wasn't finished. Test again to restart it. |
| *The credentials don't have access.* | The server answered `403 Forbidden`. |
| *Timed out after 90s* | The server didn't finish the handshake. Look at its stderr output for clues. |

A test only proves the server can start on your machine. Each app still starts the server itself, with its own environment. See [Troubleshooting](./troubleshooting) if a server works in Kumi but not in an app.
