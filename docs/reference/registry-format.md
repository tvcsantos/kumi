# Registry file format

A [static JSON file registry](../guide/registries#static-json-file) is one JSON file that lists servers. Each server is described by a `server.json` object, the same format the [official MCP Registry](https://registry.modelcontextprotocol.io) uses.

## File shape

Kumi accepts either of these:

::: code-group

```json [Array of server.json]
[
  { "name": "com.acme/tickets", "version": "1.2.0", "...": "..." },
  { "name": "com.acme/wiki", "version": "0.4.1", "...": "..." }
]
```

```json [Registry list response]
{
  "servers": [
    { "server": { "name": "com.acme/tickets", "version": "1.2.0" }, "_meta": {} },
    { "server": { "name": "com.acme/wiki", "version": "0.4.1" }, "_meta": {} }
  ]
}
```

:::

The second shape is what the registry API's `GET /servers` returns, so you can save a response from any registry and serve it as a file.

Every entry needs a `name` and a `version`; entries without them are skipped. If a file has several entries with the same name, Kumi uses the one flagged `isLatest` in `_meta["io.modelcontextprotocol.registry/official"]`, or else the last one in the file. Entries whose `status` there is set to anything other than `active` are hidden.

## server.json

The fields Kumi reads:

```jsonc
{
  "name": "com.acme/tickets",          // unique, reverse-DNS style
  "title": "Acme Tickets",             // display name
  "description": "Search and update Acme tickets.",
  "version": "1.2.0",
  "websiteUrl": "https://acme.example/mcp",
  "repository": { "url": "https://github.com/acme/tickets-mcp", "source": "github" },
  "icons": [{ "src": "https://acme.example/icon.png", "mimeType": "image/png", "theme": "light" }],

  // Ways to run it locally
  "packages": [
    {
      "registryType": "npm",            // npm | pypi | oci | nuget
      "identifier": "@acme/tickets-mcp",
      "version": "1.2.0",
      "runtimeHint": "npx",             // optional: override the command
      "transport": { "type": "stdio" },
      "environmentVariables": [
        { "name": "ACME_TOKEN", "description": "API token", "isRequired": true, "isSecret": true },
        { "name": "ACME_REGION", "default": "eu", "choices": ["eu", "us"] }
      ],
      "runtimeArguments": [],
      "packageArguments": [
        { "type": "named", "name": "--project", "description": "Default project key", "valueHint": "KEY" }
      ]
    }
  ],

  // Ways to reach it remotely
  "remotes": [
    {
      "type": "streamable-http",        // streamable-http | sse
      "url": "https://mcp.acme.example/{tenant}/mcp",
      "variables": { "tenant": { "description": "Your tenant id", "isRequired": true } },
      "headers": [
        { "name": "Authorization", "value": "Bearer {token}", "variables": { "token": { "isSecret": true, "isRequired": true } } }
      ]
    }
  ]
}
```

## Inputs

Environment variables, arguments, headers and URL variables are all *inputs*, and each becomes a field in the install form:

| Field | Effect |
|---|---|
| `description` | Help text under the field. |
| `isRequired` | The form won't continue without it. |
| `isSecret` | Masked, hidden in previews, and eligible for [secure storage](../guide/secrets). |
| `format` | `string`, `number`, `boolean` or `filepath`. Numbers are validated. |
| `default` | Prefilled; used when the field is left empty. |
| `placeholder` | Shown in an empty field. |
| `choices` | A dropdown; the value must be one of them. |
| `value` | A fixed value. `{placeholders}` in it become their own fields, described by `variables`. |

An input with a `value` and no placeholders needs no field at all; it's written as is.

### Arguments

Arguments also have:

| Field | Effect |
|---|---|
| `type` | `positional` (just the value) or `named` (`name` then the value, e.g. `--project KEY`). |
| `name` | The flag, for named arguments. |
| `valueHint` | The field label when there's no `name`. |
| `isRepeated` | The field takes one value per line, and each becomes its own argument. |

## How a package becomes a command

| `registryType` | Command | Arguments |
|---|---|---|
| `npm` | `npx` | `-y <identifier>@<version> <packageArguments>` |
| `pypi` | `uvx` | `<identifier>@<version> <packageArguments>` |
| `oci` | `docker` | `run -i --rm -e <VAR>… <identifier>:<version> <packageArguments>` |
| `nuget` | `dnx` | `<identifier>@<version> <packageArguments> --yes` |

`runtimeHint` replaces the command. When `runtimeArguments` are given, they replace the defaults (`-y` for npx; `run -i --rm` for Docker if they don't start with `run`). Environment variables are set on the server's process; for Docker they're also passed into the container with `-e`.

Packages with another `registryType` (for example `mcpb`), or whose `transport` isn't `stdio`, are listed but can't be installed yet.

## Kumi's extension: private network

A registry can tell Kumi that a server only works on a private network, such as a company VPN. Kumi then marks it on Discover, the server page and Installed, warns in the install wizard, and names the network when a test fails. See [Servers on a private network](../guide/test-connection#servers-on-a-private-network).

The flag lives under Kumi's key, `pt.com.santos.tiago/kumi`:

```json
{ "private": true, "vpn": "Acme GlobalProtect" }
```

| Field | Effect |
|---|---|
| `private` | `true`: the server only works on a private network, whether it runs locally or is hosted. Anything else is ignored. |
| `vpn` | Optional. What to connect to, as people know it. Used in messages ("connect to Acme GlobalProtect"); without it, Kumi says "your VPN". |

It covers the whole server: the hosted URLs, and the packages, which usually call an internal service too. If one way to run a server is public and another private, list them as two servers.

### Where to put it

There are two places, depending on who writes it.

**In `server.json`**, written by the server's publisher. Put it inside `io.modelcontextprotocol.registry/publisher-provided`:

```json
{
  "name": "com.acme/tickets",
  "description": "Search and update Acme tickets.",
  "version": "1.2.0",
  "remotes": [{ "type": "streamable-http", "url": "https://mcp.acme.internal/tickets" }],
  "_meta": {
    "io.modelcontextprotocol.registry/publisher-provided": {
      "pt.com.santos.tiago/kumi": { "private": true, "vpn": "Acme GlobalProtect" }
    }
  }
}
```

This works in every kind of registry. It's the only place that works in one running the official registry software (the public registry, or a copy you host): it keeps only `publisher-provided` in a server's `_meta`, and refuses to publish a server with any other key there.

**Next to `server`**, written by whoever runs the registry, in the [list response shape](#file-shape):

```json
{
  "servers": [
    {
      "server": { "name": "com.acme/tickets", "description": "Search and update Acme tickets.", "version": "1.2.0" },
      "_meta": {
        "pt.com.santos.tiago/kumi": { "private": true, "vpn": "Acme VPN (EU gateway)" }
      }
    }
  ]
}
```

Use this one in a static file, to say a server is private in your setup without changing its `server.json`. Registries running the official software fill this `_meta` themselves, so it can't be set there.

If both places have the flag, the server is private, and the `vpn` from next to `server` wins.

## Example: a minimal private catalog

```json
[
  {
    "name": "com.acme/tickets",
    "title": "Acme Tickets",
    "description": "Search and update Acme tickets.",
    "version": "1.2.0",
    "remotes": [
      {
        "type": "streamable-http",
        "url": "https://mcp.acme.example/mcp",
        "headers": [{ "name": "Authorization", "description": "Bearer <token>", "isRequired": true, "isSecret": true }]
      }
    ]
  },
  {
    "name": "com.acme/wiki",
    "title": "Acme Wiki",
    "description": "Read the internal wiki.",
    "version": "0.4.1",
    "packages": [
      {
        "registryType": "npm",
        "identifier": "@acme/wiki-mcp",
        "version": "0.4.1",
        "transport": { "type": "stdio" },
        "environmentVariables": [{ "name": "WIKI_TOKEN", "isRequired": true, "isSecret": true }]
      }
    ]
  }
]
```

Host it anywhere that serves JSON over `https` (a raw file in a private repo works, with an `Authorization` [header](../guide/registries#headers)), or keep it on disk and add it by absolute path.
