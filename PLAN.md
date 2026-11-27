# Kumi — MCP Marketplace & Manager (Desktop)

> *Kumi* (組): "group, set, team"; also "to assemble" or "to braid", as in *kumihimo*, braided cord. Here, one place that assembles your MCP servers into a single set and weaves it into every AI tool you use.

## 1. Goal

A cross-platform Electron desktop app where users can:

1. **Browse** a catalog of MCP (Model Context Protocol) servers from one or more registries (search, featured, categories, details).
2. **Choose target apps**: Claude Desktop, Claude Code, VS Code (incl. GitHub Copilot agent mode), Cursor, OpenAI Codex, GitHub Copilot CLI, OpenCode, Pi, Junie, Air in JetBrains IDEs, and Zed.
3. **Fill in settings** (env vars, API keys, arguments, URLs, headers) in a form generated from the server's metadata.
4. **Install**: Kumi writes the correct config, in the correct format and location, for each selected app.
5. **Manage**: view what's installed where, test it, edit settings, uninstall, and restore backups.

### Non-goals (v1)

- Hosting or running MCP servers ourselves. Apps run them; Kumi only configures them (and briefly starts them for Test connection).
- Running our own registry backend. We use the official MCP Registry, registries the user adds, and a curated overlay.
- Mobile or web versions.

---

## 2. Target apps & config formats

Each app gets an **adapter** that knows where its config lives, its format, and which transports it supports. This table is the core domain knowledge; every row needs fixture-based tests. Formats change between app releases, so check each against current vendor docs when touching its adapter. The user-facing copy of this table is `docs/reference/apps.md`.

| App | Scope | Path (macOS / Linux / Windows) | Format | Root key | Notes |
|---|---|---|---|---|---|
| **Claude Desktop** | user | `~/Library/Application Support/Claude/claude_desktop_config.json` / `~/.config/Claude/claude_desktop_config.json` / `%APPDATA%\Claude\claude_desktop_config.json` | JSON | `mcpServers` | stdio only. Remote servers through `mcp-remote`. Needs an app restart. |
| **Claude Code** | user | `~/.claude.json` (or `$CLAUDE_CONFIG_DIR`) | JSON | `mcpServers` (top level) | `type`: `stdio` \| `http` \| `sse`. The file also holds a lot of unrelated state, so patch it surgically. |
| | local | `~/.claude.json` → `projects["<abs path>"].mcpServers` | JSON | | Per-project, private to the user. |
| | project | `<repo>/.mcp.json` | JSON | `mcpServers` | Shared through git. Supports `${VAR}` expansion. |
| | (alt) | `claude mcp add-json <name> '<json>' --scope …` | CLI | | Not used yet. |
| **VS Code** (incl. **GitHub Copilot** agent mode) | user | `~/Library/Application Support/Code/User/mcp.json` (+ `Code - Insiders`, profiles) | **JSONC** | `servers` (+ `inputs`) | `inputs` with `promptString` + `password: true` lets VS Code prompt for secrets and store them itself. |
| | workspace | `<repo>/.vscode/mcp.json` | JSONC | `servers` | |
| | (alt) | `code --add-mcp '<json>'` | CLI | | Not used yet. |
| **Cursor** | user | `~/.cursor/mcp.json` | JSON | `mcpServers` | Remote: `url` + `headers`. |
| | project | `<repo>/.cursor/mcp.json` | JSON | `mcpServers` | |
| **OpenAI Codex** (CLI / IDE ext) | user | `~/.codex/config.toml` (or `$CODEX_HOME`) | **TOML** | `[mcp_servers.<name>]` | `command`, `args`, `env`, `env_vars` (pass-through), `url`, `bearer_token_env_var`, timeouts. |
| | (alt) | `codex mcp add <name> -- <cmd>` | CLI | | Not used yet. |
| **GitHub Copilot CLI** | user | `~/.copilot/mcp-config.json` | JSON | `mcpServers` | Separate from VS Code. |
| **OpenCode** | user | `~/.config/opencode/opencode.json` (follows `XDG_CONFIG_HOME`) | **JSONC** | `mcp.servers` | `type`: `local` (`command` is one array, env in `environment`) \| `remote` (`url`, `headers`, Streamable HTTP only; SSE via `mcp-remote`). |
| | project | `<repo>/opencode.json` | JSONC | `mcp.servers` | Also read from `.opencode/opencode.json`. |
| **Pi** | user | `~/.pi/agent/mcp.json` (or `$PI_CODING_AGENT_DIR`) | JSON | `mcpServers` | Built-in MCP (Pi 0.99+). `command` selects stdio, `url` selects Streamable HTTP; SSE through `mcp-remote`. |
| | project | `<repo>/.pi/mcp.json` | JSON | `mcpServers` | Read only after project trust is granted. |
| **Junie** (CLI + JetBrains plugin) | user | `~/.junie/mcp/mcp.json` | JSON | `mcpServers` | Shared by the CLI and the IDE plugin. `command` or `url`, no `type`; SSE through `mcp-remote`. |
| | project | `<repo>/.junie/mcp/mcp.json` | JSON | `mcpServers` | |
| **Air in JetBrains IDEs** | user | `~/.jetbrains/mcp/mcp.json` | JSON | `mcpServers` | The IDE plugin, not the standalone Air app. One global file, no project scope. Explicitly no SSE, so it goes through `mcp-remote`. |
| **Zed** | user | `~/.config/zed/settings.json` (macOS ignores `XDG_CONFIG_HOME`) / `$XDG_CONFIG_HOME/zed/settings.json` / `%APPDATA%\Zed\settings.json` | **JSONC** | `context_servers` | Shares the file with every other Zed setting. Zed reloads servers on change. Remote is Streamable HTTP only. |
| | project | `<repo>/.zed/settings.json` | JSONC | `context_servers` | |
| **Copilot in JetBrains / Visual Studio** | user/sln | JetBrains: `mcp.json` under the Copilot plugin config dir; VS: `.mcp.json` / `%USERPROFILE%\.mcp.json` | JSON | `servers` | Phase 3. |

Apps to consider later: Windsurf, Cline/Roo, Gemini CLI, Continue, LM Studio, Goose, the standalone Air app. Most JSON apps are a small `createJsonAdapter` definition plus fixtures (see `docs/contributing/adding-an-app.md`).

### Key takeaways

- **Three formats**: JSON, JSONC (with comments), and TOML. All writes must **preserve formatting, comments, and unknown keys**.
- **Different schemas for the same thing**: `mcpServers` vs `servers` vs `context_servers` vs `mcp.servers`, `type` field present or absent, `command` as a string or an array. So Kumi has a **canonical internal model** with one renderer per app.
- **Scopes**: user (global) vs project/workspace vs local. The wizard lets the user pick a scope and, for project scope, a folder.
- **Transports differ per app.** A transport an app can't use natively but can reach through `npx mcp-remote` is bridged; anything else marks the app incompatible.
- **Some apps ship a CLI** (`claude mcp`, `code --add-mcp`, `codex mcp`). Kumi edits files directly today; the CLIs remain an option for apps whose files prove too fragile.

---

## 3. Catalog / data source

### Registries
- **Official MCP Registry**: `https://registry.modelcontextprotocol.io/v0.1` (`/v0` timed out). Paginated with a cursor, supports `search`, returns versions. Some lookups take ~15s, so the client uses a 25s timeout.
- **User-added registries** (Settings → Registries, or the first-run screen):
  - **MCP Registry API** servers. Pasting just a host probes `/v0.1` then `/v0`.
  - **Static JSON files** listing `server.json` entries, from an `https` URL or a local path. Searched locally; a local file is re-read when it changes.
  - Per-registry **request headers**. Secret ones are encrypted with `safeStorage`, sent only over `https` (or `localhost`), and never sent back to the window. Kumi refuses to save them if the keychain isn't available.
  - Kumi checks a registry answers before saving it.
- The official registry is on by default, switched off when the user adds their own during setup (with a checkbox to keep it), and turned back on if nothing else is configured.
- **Merged search**: `Catalog` queries every enabled registry in parallel. Its cursor is a base64 map of per-registry cursors. A failing registry is reported next to the others' results. Servers whose status isn't `active` are hidden.
- **Cache**: `HttpCache` keeps responses in `~/.kumi/cache/registry.json`. Hits under 10 minutes are served from disk; otherwise it fetches with retries and falls back to the stale copy offline. Each registry has a **Refresh** that bypasses the cache.

Each entry is a `server.json` with:
- `packages[]`: `registryType` (`npm`, `pypi`, `oci`, `nuget`, `mcpb`), `identifier`, `version`, `transport`, `runtimeHint` (`npx`, `uvx`, `docker`, `dnx`, …), `runtimeArguments`, `packageArguments`, and **`environmentVariables[]`** (`name`, `description`, `isRequired`, `isSecret`, `default`, `format`, `choices`).
- `remotes[]`: `type` (`streamable-http` \| `sse`), `url`, and `headers[]` (with the same input metadata as env vars).

**The install form is generated from these fields** (`src/shared/variants.ts`), so no hand-written forms are needed for most servers. Package versions are pinned (`pkg@1.2.3`).

### Curated overlay
- Today: `src/shared/featured.ts`, shipped with the app (featured servers and their categories).
- Planned: a JSON file in a GitHub repo, fetched and cached, with icons, screenshots, a "verified" badge, better descriptions, **overrides** for incomplete `server.json` (missing env vars, wrong runtime hints), per-app compatibility notes, and a denylist.

### Custom servers
- **Custom server** in Installed opens the same wizard with a plain form first: name, type (stdio / Streamable HTTP / SSE), command + args + env, or URL + headers. Env vars and headers are treated as secrets by name (`key`, `token`, `secret`, `auth`, …).
- Not yet: paste a JSON entry.

---

## 4. Architecture

```
┌──────────────────────────── Electron ─────────────────────────────┐
│ Renderer (React, sandboxed, context isolation)                    │
│   Welcome · Discover · Server detail · Install wizard · Installed │
│   · Settings · About                                              │
│                     │  window.kumi (typed, zod-validated IPC)     │
│ Preload  ───────────┘                                             │
│                                                                   │
│ Main process (Node)                                               │
│  ├─ Catalog          merged search over every enabled registry    │
│  │   ├─ ApiRegistry   MCP Registry API client                     │
│  │   ├─ FileRegistry  static JSON file (URL or path)              │
│  │   └─ HttpCache     retries + disk cache, shared by all         │
│  ├─ RegistryStore    registries.json, encrypted header secrets    │
│  ├─ Adapters         one per app: paths, format, render, parse    │
│  ├─ config-io        JSON/JSONC/TOML edits, atomic write, diff    │
│  ├─ InstallService   plan → preview → apply, ownership, uninstall │
│  ├─ BackupService    copies before every write, restore           │
│  ├─ StateStore       state.json: what Kumi installed, where       │
│  ├─ SettingsStore    settings.json                                │
│  ├─ SecretBox        Electron safeStorage (OS keychain)           │
│  ├─ runtime          detect npx / uvx / docker / …                │
│  ├─ health           MCP handshake + tools/list, OAuth sign-in    │
│  ├─ updater          check, download, install app updates         │
│  ├─ host             PATH and config vars from the login shell    │
│  ├─ tls              trust the OS certificate store too           │
│  └─ log              ~/.kumi/logs/kumi.log                        │
└───────────────────────────────────────────────────────────────────┘
```

### Tech stack
- **Electron** + **electron-vite**, **TypeScript** everywhere.
- **React** + **TanStack Query** + **Tailwind**, with Kumi's own components (`components/ui.tsx`) and **lucide** icons.
- **Forms**: built at runtime by `src/shared/variants.ts` from `environmentVariables`, `packageArguments`, and `headers` (fields, validation, resolution into a `ServerSpec`). It's pure and shared, so the renderer shows a live preview and main can trust the result.
- **Config I/O**:
  - JSON / JSONC: `jsonc-parser` (`modify` + `applyEdits`).
  - TOML: `smol-toml` for parsing. Kumi only removes whole `[mcp_servers.<name>]` sections it owns and appends freshly rendered ones, so the rest of the file stays byte-identical.
- **MCP client** for health checks: `@modelcontextprotocol/sdk`.
- **Secrets**: Electron `safeStorage`.
- **Packaging**: `electron-builder` (dmg + zip for x64 and arm64, NSIS, AppImage + deb). Updates through `electron-updater` on Windows/Linux and a custom macOS updater (§16).
- **Testing**: Vitest. No E2E yet.
- **Checks**: `tsc` typecheck. No linter or formatter configured yet.

### Canonical model

```ts
type Transport = 'stdio' | 'streamable-http' | 'sse';

interface ServerSpec {
  name: string;                       // config key, e.g. "github"
  transport: Transport;
  command?: string;                   // stdio
  args?: string[];
  env?: Record<string, string>;
  url?: string;                       // remote
  headers?: Record<string, string>;
  secretEnv?: string[];               // which values are secrets
  secretHeaders?: string[];
  secretArgs?: number[];
}

interface ClientAdapter {
  id: ClientId;
  displayName: string;
  scopes: ('user' | 'project' | 'local')[];
  transports: Transport[];            // supported natively
  bridgeable: Transport[];            // reachable through mcp-remote
  needsRestart: boolean;
  supportsSecureSecrets: boolean;
  configPath(env: HostEnv, scope: ScopeRef): string;
  detect(env: HostEnv): Promise<boolean>;
  readServers(text: string, scope: ScopeRef): Record<string, ServerSpec>;
  upsert(text: string, spec: ServerSpec, scope: ScopeRef, opts: RenderOptions): EditResult;
  remove(text: string, name: string, scope: ScopeRef): string;
}
```

Adapters are pure text-in, text-out. `HostEnv` gives them the home folder, platform, environment and a `which`, so tests point everything at a temporary folder. `createJsonAdapter` (`clients/common.ts`) builds most of them and applies the shared rules:

- **Bridging** (`adaptTransport`): a `bridgeable` transport becomes `npx -y mcp-remote <url> …`; anything else is rejected.
- **Windows** (`windowsWrap`): `npx` and other `.cmd` shims become `cmd /c npx …`.
- **The guard** (`assertOnlyServerChanged`): the parsed file before and after must be equal once the server entry is removed from both, or the edit is refused. Codex (TOML) has its own adapter with the same guard.

---

## 5. Install flow (UX)

1. **First run (Welcome)**: choose registries (official, your own, or both). Apps are detected by command on `PATH` or config folder.
2. **Discover**: search across registries, featured servers by category, cards with badges.
3. **Server detail**: description, variants (packages and remotes), required settings, source repo, version.
4. **Install wizard**:
   1. **Pick apps**: detected apps first; undetected ones can still be chosen (Kumi creates the file). Compatibility per app, including bridging.
   2. **Pick scope** per app: User, Project (folder picker), or Local for Claude Code.
   3. **Pick a variant** if there are several (for example `npx` vs `docker` vs hosted remote).
   4. **Configure**: generated form with required/optional fields, secrets masked, defaults, validation, help text. Editable server name with collision detection. **Test connection** is available here.
   5. **Prerequisites check**: is `npx`/`uvx`/`docker` available?
   6. **Review**: per-file **diff preview**, secrets masked, plus "What will run".
   7. **Apply**: back up → write atomically → re-read and validate → record ownership.
   8. **Result**: per app, a restart hint where needed, and Test connection.
5. **Installed**: every server in every app's config (global scope and known project folders), grouped by name and marked *managed*, *partly managed* or *added manually*. Actions: Test connection, Edit (reopens the wizard prefilled, can add more apps), Remove everywhere, and per entry open config / remove. Project folders can be added or untracked. Backups and restore live in Settings.
6. **Import / discover**: hand-added servers show up in Installed right away; editing one adopts it. Still to do: explicit "adopt", "copy to other apps" as one action, enable/disable, update.

---

## 6. Secrets strategy

Most apps expect secret values **inline in their config file** (plaintext). Kumi offers modes per install, with a default in Settings → Secrets:

| Mode | How | Status |
|---|---|---|
| **Inline** (default) | Write the value into the app config. | Done, all apps. |
| **Client-native secure** | VS Code: an `inputs` entry (`promptString`, `password: true`, id `kumi.<server>.<name>`) referenced as `${input:…}`; VS Code prompts and stores it. Apps without secure storage fall back to inline, and the review says so. | Done for VS Code. Not yet: Codex `env_vars` / `bearer_token_env_var`, `.mcp.json` `${VAR}`. |
| **Kumi secure launch** (opt-in) | Config points to `kumi-run <server-id>`, a launcher that reads secrets from the OS keychain and `exec`s the real command. | Phase 3. |

Rules:
- Never log secret values. Mask them in diffs, "What will run", backups metadata, and the UI.
- So installs can be edited later, Kumi's `state.json` keeps entered values: plain ones as is, secret ones encrypted with `safeStorage`. Without a working keychain, secret values aren't kept and editing asks for them again.
- Show the user clearly which mode is in use and where the secret ends up.

---

## 7. Safe config editing (critical)

Users' config files hold hand-tuned state. Breaking them destroys trust.

- **Read → edit → write**, never regenerate a whole file. JSON/JSONC edits go through `jsonc-parser`: comments and unrelated keys survive, but lines next to the edit may be reformatted. TOML outside Kumi's sections stays byte-identical. Every write passes the guard (§4).
- **Atomic writes**: temp file in the same dir, `fsync`, `rename`, original mode kept. New files are `0600`.
- **Backups** before every write: `~/.kumi/backups/<app>/<timestamp>-<id>-<file>`, indexed in `backups/index.json`, last 20 per file. Restore backs up the current file first, so it can be undone. A backup of a file that didn't exist restores by deleting it.
- **Concurrency**: the plan stores a hash of each file. If it changed before apply, apply stops and asks the user to review again.
- **Ownership tracking** (`~/.kumi/state.json`): which entries Kumi created (app, scope, path, key). Kumi asks before replacing or removing entries it doesn't own.
- **Validation after write**: re-read and confirm the entry is there.
- **Several targets in one file** (Claude Code's user and local scopes both live in `~/.claude.json`): edits are chained in one write.
- Not yet: warn when Claude Code is running before patching `~/.claude.json`; watch config files and refresh Installed on external changes (today it re-reads every time it's shown).

---

## 8. Health check / "Test connection"

- **stdio**: spawn the command with the resolved env, run `initialize`, call `tools/list`, shut down. Timeout, stderr captured.
- **Remote**: Streamable HTTP with headers; on `404`/`405`, retry with SSE.
- Shows server name and version, tools with descriptions, duration, and errors with hints and stderr.
- Warns that this **runs the server's code locally**.
- **OAuth servers**: on a `401` without an `Authorization` header, Kumi doesn't open the browser. It checks the server offers OAuth and shows **Server is up**. If the server supports a client ID metadata document (CIMD) or dynamic client registration, **Sign in to list tools** runs the MCP OAuth flow (discovery, client, PKCE, browser sign-in with a loopback redirect). The SDK prefers CIMD: Kumi's client ID is `https://tiago.santos.com.pt/kumi/oauth/client-metadata.json`, served from `docs/public/oauth/`, with a port-less loopback redirect (`http://127.0.0.1/callback`, RFC 8252 §7.3). With CIMD the server checks Kumi only when the browser opens, so a rejection shows there and Kumi's wait times out with a hint. Tokens stay in memory for the app session.
- Failures are written to `~/.kumi/logs/kumi.log` (rotated at 2 MB to `kumi.old.log`).
- TLS trusts the OS certificate store (macOS Keychain, Windows store, Linux system bundles) and the bundles named by `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE`, so servers and registries behind a corporate CA work.

### Private networks (VPN-only servers)

Apps connect to servers, not Kumi, so a server that only answers on a VPN installs fine. Kumi's job is to say "not reachable from here" instead of "broken", and to warn before the user relies on it.

1. **Failure causes.** A remote test failure is sorted by its system error: `dns` (`ENOTFOUND`, `EAI_AGAIN`), `timeout`, `route` (`EHOSTUNREACH`, `ENETUNREACH`), `refused`, `tls`. `dns`, `timeout` and `route` show in amber as *not reachable from this network*, with a VPN hint; the others stay red, with the real reason instead of `fetch failed`. Remote tests time out after 15s (no download to wait for). `HealthResult.unreachable` carries the cause, host and, when known, why the host is private.
2. **Settings → Private networks.** Host patterns (`*.acme.com`, `mcp`) and IP ranges (`10.42.0.0/16`), each with an optional VPN label. Built-in patterns are only the certain ones (single-label names, `*.internal`, `*.local`, `*.home.arpa`, RFC 1918, `100.64.0.0/10`, `fc00::/7`) and can be switched off. IP ranges match an IP in the URL, or the address the name resolves to after a timeout.
3. **Registry flag.** `pt.com.santos.tiago/kumi: { "private": true, "vpn"?: "…" }` means the server only works on a private network, however it runs (remote, or a package that calls an internal API). Read from the server's `_meta["io.modelcontextprotocol.registry/publisher-provided"]` (the publisher's; the only place the official registry keeps; it refuses other `_meta` keys with a 422) and from the response-level `_meta` (the registry operator's; static files and other registry software). Either marks it private; the operator's `vpn` label wins. A server mixing public and private forms is published as two servers.

A server is private when its registry flags it or a remote's host matches a pattern. That shows as a badge on Discover, the detail page and Installed, a note in the install wizard, and a specific hint when a test fails (for packages, where Kumi can't see the cause, a "may be why" hint). Not covered: system proxies and PAC files.

### Private package registries

A package can come from a registry only reachable inside a company (Artifactory, Nexus, Verdaccio, a private PyPI index, an internal container registry). The official registry only accepts public package registries, so these servers come from Kumi's own sources: a static file or a self-hosted registry.

1. **Launch command.** When `registryBaseUrl` isn't a public registry (npmjs, PyPI, nuget.org), Kumi always writes the registry into the config, so a project-scope config shared through git works for teammates: npm scoped `--@scope:registry=URL` (only that scope), npm unscoped `--registry=URL` (the whole run, so the registry must mirror npmjs), pypi `uvx --index URL` (PyPI stays for dependencies), nuget `dnx --add-source URL`. OCI images name their registry in the identifier; a bare identifier with a private `registryBaseUrl` gets the host prefixed. With a non-default `runtimeHint` (bunx, pnpm dlx), Kumi adds nothing and warns.
2. **Sign-in stays with each tool**: `.npmrc`, `~/.netrc` for uv, `NuGet.Config`, `docker login`. Kumi never writes registry credentials; a `registryBaseUrl` with `user:token@` is used without them, with a warning. The install wizard shows how to sign in.
3. **Badge.** *private registry*, separate from *private network*: the download needs the registry, but the server may run off the VPN once it's cached. The registry host is matched against Settings → Private networks for the VPN label. Shown on Discover, the detail page (per variant), Installed (read from the config's flags, so it works for servers Kumi didn't install) and the install wizard.
4. **Test.** Download failures are read from the package manager's output (npm, uv, docker, dnx): *unreachable* (amber, VPN hint), *sign-in needed* (`401`, `403`, and a `404` for the package itself on a private registry, which is what most answer when you're not signed in), *doesn't mirror npmjs* (the package was found but a dependency `404`s on the private registry), *certificate* (points to the OS certificate trust). This works for public registries too, minus the sign-in advice.

Not covered: mirror or proxy settings, editing `.npmrc` and other tool config, `mcpb` packages, a default registry for a whole source.

---

## 9. Security considerations

- Installing an MCP server means **running third-party code** with the user's privileges. Show the source repo, registry, and the exact command before install. Versions are pinned. Still to do: publisher and verification status (needs the overlay), "latest" opt-in.
- Electron hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a strict CSP, external links opened in the browser. If READMEs are rendered later, sanitize them (`DOMPurify`).
- IPC: narrow, typed, zod-validated. File paths from the window must be absolute and belong to a known config or backup. No shell commands from the renderer.
- Spawning: `execFile`/`spawn` with arg arrays, never shell strings.
- Registry and overlay data are untrusted input; validate against the schema.
- Signed builds and signed auto-updates once there are certificates (§16).
- The OAuth client metadata document (§8) is Kumi's identity on authorization servers: whoever can change it can change Kumi's redirect URIs. Its URL must never change and must be served without a redirect, so keep the custom domain on the `tvcsantos.github.io` user site, keep the domain renewed, keep the repo named `kumi` and the docs base `/kumi/`, and set no custom domain on the `kumi` repo.

---

## 10. Project structure

```
kumi/
├─ PLAN.md · README.md · LICENSE (MIT)
├─ package.json · electron.vite.config.ts · electron-builder.yml · vitest.config.mts
├─ build/                       # icons (icon.svg → png/icns via `npm run icon`)
├─ scripts/
├─ .github/workflows/           # ci.yml, release.yml, docs.yml
├─ src/
│  ├─ main/
│  │  ├─ index.ts               # app lifecycle, windows
│  │  ├─ ipc.ts                 # handlers + zod schemas
│  │  ├─ host.ts                # login-shell PATH and config vars
│  │  ├─ settings.ts · tls.ts · log.ts
│  │  ├─ catalog/               # catalog, registry (API), file, http cache, sources
│  │  ├─ clients/               # types, common, one file per app
│  │  ├─ config-io/             # json, toml, fs (atomic write), diff
│  │  ├─ install/               # service: plan, apply, uninstall
│  │  ├─ secrets/
│  │  ├─ runtime/               # detect npx/uvx/docker
│  │  ├─ health/                # check, oauth
│  │  ├─ state/                 # store, backups
│  │  └─ updater/               # github feed, version, install kind, installers, service
│  ├─ preload/
│  ├─ renderer/src/
│  │  ├─ pages/                 # Welcome, Discover, ServerDetail, Installed, Settings, About
│  │  ├─ components/            # InstallWizard, FieldInput, CustomServerForm, RegistryDialog, Updates, ui
│  │  └─ lib/
│  └─ shared/                   # api, types, registry schema, variants, featured
├─ tests/
│  ├─ fixtures/configs/ · fixtures/registry/
│  └─ *.test.ts
└─ docs/                        # VitePress site (own package): guide, reference, contributing
```

`packages/kumi-run/` (secure-launch shim) arrives with Phase 3.

---

## 11. Roadmap

> **Status (2026-11-22):** v0.2.0. Phase 0 and the Phase 1 MVP are done, most of Phase 2, and the first Phase 3 apps (Junie, Air in JetBrains IDEs, Zed). Decisions made while building:
> - Registry API is `/v0.1`, with a 25s timeout and a disk cache; featured cards load one by one.
> - JSON/JSONC edits may reformat lines next to the edit; TOML stays byte-identical outside Kumi's sections. Every write is guarded.
> - Edits are written directly to config files. Vendor CLIs are not used.
> - On launch, `PATH`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_CONFIG_HOME` and `PI_CODING_AGENT_DIR` are read from the user's login shell, because GUI launches don't inherit them.
> - No signing certificates, so macOS builds are ad-hoc signed and Windows builds unsigned; app updates are designed around that (§16).
> - Node only trusts its bundled CAs, so Kumi adds the OS trust store at startup.

### Phase 0: Foundations
- [x] Scaffold electron-vite + React + TS + Tailwind. Vitest.
- [ ] ESLint/Prettier (or Biome).
- [x] Electron security baseline (sandbox, CSP, typed IPC bridge).
- [x] CI: GitHub Actions matrix (macOS, Windows, Linux) running typecheck, tests, and build.
- [x] `config-io`: format-preserving JSON, JSONC, and TOML edit with atomic write and backup.

### Phase 1: MVP
- [x] Canonical `ServerSpec` and `ClientAdapter` interface.
- [x] Adapters: Claude Desktop, Claude Code (user + local + project), VS Code (user + workspace), Cursor (user + project), Codex (user), with fixture tests.
- [x] Catalog: official registry client, local cache, search, and the detail page.
- [x] Dynamic form from `environmentVariables`, `packageArguments`, and `headers`.
- [x] Install wizard: apps → scope → variant → configure → prereqs → diff → apply.
- [x] Installed view: grouped list, uninstall, edit, open config, project folders, restore backup.
- [x] StateStore and ownership tracking.
- [x] Inline secrets mode, plus VS Code `inputs` mode.
- [x] Unsigned builds for all three OSes (release workflow).

### Phase 2: Polish & trust
- [x] Multiple registries: MCP Registry API and static JSON files, with headers and encrypted secrets, merged search, refresh.
- [x] Custom servers (form).
- [ ] Curated overlay repo (started: `src/shared/featured.ts`): icons, overrides, verified, compatibility notes, denylist.
- [x] Health check / Test connection, including OAuth sign-in and SSE fallback.
- [ ] Import existing servers (done: listed, editing adopts them). Still: explicit adopt and "copy to other apps".
- [ ] Update detection (new registry version → update across apps).
- [ ] Enable/disable an installed server.
- [x] GitHub Copilot CLI, OpenCode and Pi adapters.
- [ ] Use vendor CLIs (`claude mcp`, `code --add-mcp`, `codex mcp`) when present.
- [x] Remote-server bridging for apps without a transport (`mcp-remote`).
- [x] Release pipeline (GitHub Releases) and Homebrew cask (bumped by hand).
- [x] Docs site (VitePress on GitHub Pages).
- [x] Log file; OS certificate trust.
- [ ] Private networks (§8): failure causes, Settings patterns, registry `private` flag.
- [ ] Private package registries (§8): registry flags in commands, badge, download failures in Test.
- [ ] Warn when Claude Code is running; watch config files for external changes.
- [ ] Code signing, notarization.
- [ ] App updates: see [§16](#16-app-updates) (in-app on all platforms done; Homebrew tap bump left).

### Phase 3: Power features
- [ ] `kumi-run` secure-launch shim with OS keychain.
- [ ] Client-native secrets for Codex (`env_vars`, `bearer_token_env_var`) and `.mcp.json` (`${VAR}`).
- [ ] More apps: done Junie, Air in JetBrains IDEs, Zed. Next: Windsurf, Cline, Gemini CLI, JetBrains/Visual Studio Copilot, Continue.
- [ ] Profiles / bundles ("Web dev pack": install N servers at once) and export/import of a setup.
- [ ] Deep links: `kumi://install?server=io.github.foo/bar`, so websites can show an "Install with Kumi" button.
- [ ] Companion `kumi` CLI for headless and CI use.

---

## 12. Testing strategy

Current suites (`tests/`, Vitest, run in Node without Electron):

| Suite | Covers |
|---|---|
| `adapters.test.ts` | Every adapter: round-trips, bridging, Windows wrapping, golden tests against fixture configs (compared byte for byte; `.gitattributes` keeps them LF). |
| `config-io.test.ts` | Format-preserving JSON/JSONC/TOML edits, atomic writes. |
| `install-service.test.ts` | Plan, apply, uninstall and backups on a temp home, including a file changing between plan and apply. |
| `catalog.test.ts` | Registry clients against recorded responses, merged search, registry storage and headers. |
| `variants.test.ts` | `server.json` → form fields → `ServerSpec`. |
| `health-oauth.test.ts` | OAuth detection and sign-in flow. |
| `updater.test.ts` | Version comparison, channels, install kind, downloads, macOS blockers, service state machine. |
| `tls.test.ts`, `log.test.ts` | Certificate loading, log rotation. |

Still to do:
- **Round-trip property tests**: `readServers(upsert(spec)) == spec` for generated specs on every adapter.
- **E2E (Playwright + Electron)**: browse → install into a fake home → assert files written → uninstall → assert byte-identical.
- **Manual smoke matrix** per release: open each real app and confirm the server shows up and works.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| App config formats change without notice | Isolated adapters, fixture tests, fast release cadence. Later: vendor CLIs, version detection with a warning on unknown versions. |
| Corrupting a user's config | Format-preserving edits, the guard, atomic writes, backups, diff preview, ownership tracking. |
| `~/.claude.json` races with a running Claude Code | Minimal patch and the hash check. Still to do: warn if it's running, or use the `claude` CLI. |
| Plaintext secrets | Secure modes (§6), clear disclosure. |
| Malicious or low-quality servers in the registry | Pinned versions, command shown before install. Later: verified badges, publisher info, overlay denylist. |
| Incomplete registry metadata (missing env vars) | Custom servers today; overlay overrides later. |
| Windows path and quoting quirks (`npx` → `npx.cmd`, `cmd /c`) | `windowsWrap` in adapters, Windows CI. |
| Corporate networks (TLS interception, internal CAs) | OS trust store added at startup. |
| No signing certificates | Ad-hoc / unsigned builds, custom macOS updater, quarantine instructions in docs. |

---

## 14. Open questions

Settled: distribution is GitHub Releases plus a Homebrew cask; the license is MIT; the default secrets mode is inline; the name is Kumi.

1. **More distribution**: winget, Snap/Flatpak?
2. **Catalog scope**: also index other sources (Smithery, Glama, mcp.so) where their terms allow, or leave that to user-added registries?
3. **Claude Code scope default**: user, or ask every time?
4. **Telemetry**: none, or opt-in anonymous install counts (useful for "popular" ranking)?
5. **Overlay hosting**: separate repo, or a file in this one?

---

## 15. Definition of done (MVP)

A user on macOS, Windows, or Linux can open Kumi, search "github", click Install, tick Claude Code + Cursor + VS Code, paste a token, review the diff, and click Apply. Then the GitHub MCP server works in all three tools without the user touching a config file, and they can uninstall it from all three with one click, leaving their configs otherwise byte-identical.

---

## 16. App updates

Releases go to GitHub with electron-builder's `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, the mac `.zip`s and blockmaps, so an updater has what it needs. What shapes the design: there are **no signing certificates**. macOS builds are ad-hoc signed and not notarized, and Windows builds are unsigned.

| Install | Update path |
|---|---|
| Windows NSIS (`.exe`) | In-app, via `electron-updater`. It skips signature checks when `publisherName` isn't set. A UAC prompt may appear for Program Files installs. |
| Linux AppImage | In-app, via `electron-updater` (AppImageUpdater). |
| Linux `.deb` | Notify only. Updating needs root, so Kumi links to the new `.deb`. |
| macOS, DMG download | In-app, via a custom updater. Squirrel.Mac rejects ad-hoc signed apps, because the designated requirement is the cdhash, which changes every build. |
| macOS, Homebrew cask | **Notify only, leave it to brew**. Kumi shows `brew upgrade --cask kumi` with a copy button. The cask keeps no `auto_updates`, so brew's version record stays correct. Detected by `Caskroom/kumi` under `/opt/homebrew` or `/usr/local`, for a copy in `/Applications` or `~/Applications` (where the cask puts it). A second copy elsewhere updates itself. |
| Dev build, app run from the DMG or a read-only location | Notify only. |

**Custom macOS updater.** Read `latest-mac.yml` and pick the zip for `process.arch`. Download it with Node's `fetch`, which leaves no quarantine flag, and check its size and `sha512`. Unzip with `ditto -x -k` into a temp dir, then run `codesign --verify --deep --strict` (an ad-hoc signature still seals the bundle) and check `CFBundleShortVersionString`. When the user quits or clicks "Restart to update", a detached script waits for Kumi to exit, swaps `Kumi.app` (keeping the old copy until the swap succeeds) and relaunches it. Refuse when the app is translocated or its folder isn't writable. Integrity rests on HTTPS to GitHub plus the yml hash, the same trust as the first download. With an Apple Developer ID, drop this and use electron-updater's standard path.

**Never restart on its own.** Kumi edits config files, so it must not quit in the middle of the install wizard. Updates install on quit or when the user clicks "Restart to update".

### Phases
- [x] **1. Check and notify, everywhere.** `src/main/updater/` checks GitHub Releases on startup and every 6 hours (packaged builds only). Settings: `autoCheckUpdates` (on) and `updateChannel` (`stable` / `prerelease`, since `-rc` tags become prereleases). About has "Check for updates". A dismissible banner offers release notes plus Download (opens the release page) or the brew command.
- [x] **2. In-app on Windows and AppImage.** `ElectronInstaller` (`NsisUpdater` / `AppImageUpdater`) behind the `Installer` interface. The service downloads in the background once a check finds a newer release, then shows "Restart to update". `autoInstallOnAppQuit` installs on quit. Not yet run on a real Windows or Linux machine.
- [x] **3. Custom macOS updater** (`MacInstaller`, described above), for non-Homebrew installs. Tested end to end with packaged builds: 0.1.5 → 0.1.6, both through "Restart to update" and by quitting.
- [x] **4. Important and required updates.** `Kumi-Update` trailers on the tag (`important` / `required`, optional reason and platforms; `npm run release:required`). Every release's notes start with hidden lines for the requirements still in force (`<!-- kumi:required 2.0.0 platforms=mac reason -->`), which the workflow carries forward from the previous release and prunes (`scripts/release-levels.mjs`, used by the workflow and the release script; Kumi reads the lines with its own parser in `src/main/updater/levels.ts`, and a contract test keeps the two in step). So the newest release alone forces someone several releases behind; Kumi updates to the latest. Markers are remembered in `state.json`, never withdrawn, and acted on even with `autoCheckUpdates` off, which now only silences ordinary releases. The first check runs at startup. `important`: a banner that can't be dismissed. `required`: a full-window screen (update, release notes, log, About, Quit), and IPC refuses everything else (`ALLOWED_WHILE_UPDATE_REQUIRED`). Dev builds ignore markers unless `KUMI_UPDATE_FEED` is set.
- [ ] Release workflow bumps the Homebrew tap (version and both hashes), so brew users get updates as soon as releases ship.

**Testing.** Unit tests cover version comparison, channel selection, install-kind detection, the yml/zip choice, download verification, the macOS blockers and the service's state machine. For a run end to end, set `KUMI_UPDATE_FEED` to a local server. It answers `/releases` like GitHub's API and serves `/download/v<version>/<file>`: `latest-mac.yml` and the zip for macOS, `latest.yml` / `latest-linux.yml` and the installer elsewhere (electron-updater uses a generic feed there). Build the old and new apps with `electron-builder --mac dir -c.extraMetadata.version=<new>`.
