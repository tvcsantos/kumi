# Custom servers

Not every server is in a registry. To add one by hand, click **Custom server** in [Installed](./installed). The wizard is the same as for registry servers, except the first step is a plain form.

## Fields

| Field | Notes |
|---|---|
| **Name** | The config key. Letters, digits, `-` and `_`. |
| **Type** | **Local command (stdio)**, **Remote (Streamable HTTP)** or **Remote (SSE, legacy)**. |

### Local command (stdio)

| Field | Format |
|---|---|
| **Command** | The program to run, for example `npx`, `uvx`, `docker`, or an absolute path. |
| **Arguments** | One per line. |
| **Environment variables** | `KEY=value`, one per line. |

### Remote

| Field | Format |
|---|---|
| **URL** | An `http` or `https` URL. |
| **Headers** | `Name: value`, one per line. |

## Secrets

Environment variables and headers whose names contain `key`, `token`, `secret`, `password`, `passwd`, `auth`, `credential` or `cookie` (in any case) are treated as secrets: masked in the preview, and moved to VS Code's secure storage if you choose that [secrets mode](./secrets).

## Example

A local server that runs a Python script:

```
Name:        notes
Type:        Local command (stdio)
Command:     uv
Arguments:   run
             /Users/me/code/notes-mcp/server.py
Environment: NOTES_DIR=/Users/me/notes
```

A hosted server with a bearer token:

```
Name:    acme
Type:    Remote (Streamable HTTP)
URL:     https://mcp.acme.example/mcp
Headers: Authorization: Bearer sk-…
```

From here, [choose apps, review and install](./install#_2-choose-apps) as usual.
