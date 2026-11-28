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

Packages with another `registryType`, or whose `transport` isn't `stdio`, are listed but can't be installed yet. `mcpb` bundles work differently; see below.

## Bundles (`mcpb`)

An [MCP Bundle](https://github.com/modelcontextprotocol/mcpb) is a zip with the server's code and a `manifest.json` that says how to run it and which settings it takes. For a bundle, only these package fields are used:

| Field | Use |
|---|---|
| `registryType` | `mcpb` |
| `identifier` | The bundle's download URL. Must be `https`. |
| `fileSha256` | Required. Kumi refuses a download that doesn't match it. |
| `transport` | Must be `stdio` (or left out). |

```json
{
  "registryType": "mcpb",
  "identifier": "https://github.com/acme/files-mcp/releases/download/v1.2.0/files.mcpb",
  "fileSha256": "fe333e598595000ae021bd27117db32ec69af6987f507ba7a63c90638ff633ce",
  "transport": { "type": "stdio" }
}
```

The manifest decides the command and the settings, so `runtimeHint`, `runtimeArguments`, `packageArguments`, `registryBaseUrl` and `version` are ignored. `environmentVariables` are shown on the detail page as a hint, but the form comes from the manifest's `user_config`.

### What Kumi does with a bundle

1. Downloads it when you pick the variant in the install wizard, checks the SHA-256, and unpacks it into `~/.kumi/bundles/<sha256>/` (see [Data directory](./data-directory#bundles)). A bundle already there isn't downloaded again.
2. Builds the form from `user_config`: `string` (masked when `sensitive`), `number` (with `min` / `max`), `boolean`, `file` and `directory` (with a picker; one per line when `multiple`). Defaults can use `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}` and `${DOWNLOADS}`.
3. Writes the manifest's `mcp_config` into each app's config, with the `platform_overrides` for your OS applied (an override's `command` and `args` replace the base ones, its `env` is added). Variables are filled in:

| Variable | Becomes |
|---|---|
| `${__dirname}` | The folder the bundle was unpacked to |
| `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}` | Your folders |
| `${pathSeparator}`, `${/}` | `/`, or `\` on Windows |
| `${user_config.<key>}` | The value you entered |

An argument that is exactly a `multiple` setting becomes one argument per value. Inside a longer string or an env var, the values are joined with `:` (`;` on Windows). An argument or env var whose optional setting is empty is left out.

A `uv` bundle without `mcp_config` runs with `uv run --directory <bundle> <entry_point>`. On Windows, `.exe` is added to a bundled program's path. A bundle whose `compatibility.platforms` leaves out your OS can't be installed. Manifests from before MCPB (with `dxt_version`) are read too.

Bundles install into global and local scopes only. The config points at the bundle's folder on your machine, so it can't go in a project config shared through the repo: a teammate has no such folder, and their Kumi doesn't know to download it.

When the bundle asks for a version in `compatibility.runtimes` (`node` or `python`), the install wizard shows it, and warns if the `node` or `python3` on your PATH is older. It only warns: with a version manager such as nvm, fnm or pyenv, your apps may run a different version than the one Kumi finds.

Not covered: bundle signatures.

## Packages from a private registry

`registryBaseUrl` says where the package is downloaded from. Leave it out, or set it to the public registry (`https://registry.npmjs.org`, `https://pypi.org`, `https://api.nuget.org/v3/index.json`), and Kumi writes nothing extra: each tool uses its own settings, including any company mirror.

Set it to a company registry, and Kumi writes it into the command, so every app (and every teammate sharing a project config) downloads from there:

| `registryType` | `registryBaseUrl` is | Added before the package |
|---|---|---|
| `npm`, scoped (`@acme/tickets`) | the registry URL | `--@acme:registry=<url>`: only `@acme` packages come from it. |
| `npm`, unscoped (`tickets`) | the registry URL | `--registry=<url>`: the package **and all its dependencies** come from it, so it must also mirror npmjs.org. Publish under a scope to avoid that. |
| `pypi` | the index URL uv uses, usually ending in `/simple` | `--index <url>`: the package comes from it, and PyPI stays available for dependencies. |
| `nuget` | the NuGet service index (`…/v3/index.json`) | `--add-source <url>` |
| `oci` | the registry, e.g. `https://registry.acme.com` | Nothing: put the host in `identifier` (`registry.acme.com/team/tickets`). A bare `team/tickets` gets the host from `registryBaseUrl`. |

```json
{
  "registryType": "npm",
  "registryBaseUrl": "https://npm.acme.com/",
  "identifier": "@acme/tickets",
  "version": "1.2.0"
}
```

becomes `npx -y --@acme:registry=https://npm.acme.com/ @acme/tickets@1.2.0`.

- **Sign-in stays with each tool**: `npm login`, `~/.netrc` for uv, `docker login`, your `NuGet.Config`. Don't put credentials in `registryBaseUrl`: Kumi leaves them out of the config and warns.
- With a `runtimeHint` other than the default (for example `bunx`), Kumi can't pass the registry, and says so in the install wizard.
- Images on Docker Hub, `ghcr.io`, `quay.io`, `mcr.microsoft.com`, `public.ecr.aws`, `gcr.io` and `registry.gitlab.com` count as public.
- The official registry only accepts public package registries, so these entries go in [your own registry](../guide/registries), like a static file.

Such packages get a **private registry** badge. See [Packages from a private registry](../guide/test-connection#packages-from-a-private-registry).

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
