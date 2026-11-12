# Security

## Installing a server runs its code

An MCP server is a program. When you install one, your AI apps start it with your user's permissions. Kumi makes the decision visible, but it can't make a server safe:

- Check who publishes a server and where its source lives (both are on the detail page) before you install it.
- Kumi pins the version the registry lists, so a package can't change without you installing an update.
- **What will run** in the install wizard shows the exact command or URL.
- [Test connection](./test-connection) runs the server too. Only test servers you trust.

## Secrets

- Secrets are masked in previews and diffs.
- Values Kumi keeps for later edits, and registry header secrets, are encrypted with the OS keychain. If the keychain isn't available, Kumi doesn't store them.
- Registry secret headers are only sent over `https`.
- VS Code users can keep secrets out of config files entirely. See [Secrets](./secrets).

## The app

Kumi follows Electron's security recommendations:

- The window is sandboxed, with context isolation on and Node.js integration off.
- A strict Content Security Policy: scripts only from the app itself, no remote code.
- The window talks to the rest of the app through a narrow, typed API (`window.kumi`). Every call is validated with [zod](https://zod.dev) before it runs.
- Links open in your browser. The app window never navigates away, and permission requests (camera, notifications, …) are denied.
- Commands are started with argument arrays, never through a shell string.
- Registry responses are treated as untrusted input.

## Reporting a vulnerability

Please report security issues privately, from the [Security tab](https://github.com/tvcsantos/kumi/security) of the repository, rather than in a public issue.
