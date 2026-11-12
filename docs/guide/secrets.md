# Secrets

Many servers need an API key or a token. Kumi marks those settings as secret (from `isSecret` in the server's `server.json`, or by name for [custom servers](./custom-servers#secrets)) and handles them carefully.

## Where secrets end up

Most AI apps only read secrets from their own config file, in plain text. That is what you'd get setting a server up by hand, and it's Kumi's default. You can choose a different mode per install, and set the default in **Settings → Secrets**.

| Mode | How it works | Apps |
|---|---|---|
| **Write into config files** (default) | The value is written into the app's config file. | All |
| **Use the app's secure storage** | Kumi writes a reference instead of the value. The app asks for the secret once and stores it itself. | VS Code |

Apps without secure storage fall back to writing the value into their config, and the review step tells you so.

### VS Code secure storage

With secure storage, Kumi adds an `inputs` entry to VS Code's `mcp.json` for each secret, and points the server at it:

```jsonc
{
  "servers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "${input:kumi.github.Authorization}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "kumi.github.Authorization",
      "description": "Authorization (header) for MCP server \"github\"",
      "password": true
    }
  ]
}
```

The first time VS Code starts the server, it prompts for the value and keeps it in its own secret storage. Kumi's inputs are prefixed with `kumi.<server>.`, so it can update or remove them without touching yours.

## What Kumi keeps

So you can [edit an install](./install#editing-an-install) later without retyping everything, Kumi keeps the values you entered in its own state file:

- Plain values are stored as they are.
- Secret values are encrypted with the OS keychain through Electron's `safeStorage`.

If the keychain isn't available or can't encrypt, Kumi doesn't store the secret values at all. The install still works; editing it later just asks for them again.

## Where secrets are hidden

- In the install preview and diff, secret values are replaced with `••••••••`.
- In **What will run**, the command or URL is shown with secrets masked.
- Saved registry header secrets are never sent back to the window, only their names.

## Registry credentials

Headers you add to a [registry](./registries#headers) work the same way: secret ones are encrypted with the OS keychain, and Kumi refuses to save them if the keychain isn't available.
