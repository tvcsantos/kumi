# Architecture

```
┌──────────────────────────── Electron ─────────────────────────────┐
│ Renderer (React, sandboxed, context isolation)                    │
│   Discover · Server detail · Install wizard · Installed · Settings│
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
│  ├─ SecretBox        Electron safeStorage (OS keychain)           │
│  ├─ health           MCP handshake + tools/list                   │
│  └─ host             PATH and config vars from the login shell    │
└───────────────────────────────────────────────────────────────────┘
```

## The canonical model

Every app describes the same thing differently. Kumi turns registry metadata into one app-independent `ServerSpec`, and each adapter renders it into its app's format:

```ts
interface ServerSpec {
  name: string;                       // config key, e.g. "github"
  transport: 'stdio' | 'streamable-http' | 'sse';
  command?: string;                   // stdio
  args?: string[];
  env?: Record<string, string>;
  url?: string;                       // remote
  headers?: Record<string, string>;
  secretEnv?: string[];               // which values are secrets
  secretHeaders?: string[];
  secretArgs?: number[];
}
```

`src/shared/variants.ts` does the first half: it lists a server's install **variants** (each package and each remote), generates the form **fields** for one, validates the values, and resolves them into a `ServerSpec`. It's pure and shared, so the renderer can show a live preview and the main process can trust the result.

## Adapters

An adapter (`src/main/clients/`) knows one app:

```ts
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

Adapters are pure text-in, text-out. They never touch the file system themselves; `HostEnv` gives them the home folder, platform, environment and a `which`, so tests can point everything at a temporary folder.

Most apps use a JSON object with a map of servers, so `createJsonAdapter` in `common.ts` builds them from a small definition. It also handles the shared rules:

- **Bridging** (`adaptTransport`): a transport the app can't use natively but lists in `bridgeable` is rewritten as `npx -y mcp-remote <url> …`; anything else is rejected.
- **Windows** (`windowsWrap`): `npx` and other `.cmd` shims become `cmd /c npx …`.
- **The guard** (`assertOnlyServerChanged`): the parsed file before and after must be equal once the server entry is removed from both. Otherwise the edit is refused.

Codex (TOML) has its own adapter with the same guard.

## Install flow

`InstallService` (`src/main/install/service.ts`) works in two phases:

1. **Plan.** For each target app and scope, read the config, check for a name collision and whether Kumi owns the existing entry, compute the new text with the adapter, and compute a diff from a copy with secrets masked. Several targets can share a file (Claude Code's global and local scopes both live in `~/.claude.json`), so edits to the same file are chained. The plan stores the new text and a hash of the original, and returns only the masked diff to the window.
2. **Apply.** For each file, check the hash still matches, back the file up, write it atomically, read it back to confirm the server is there, and record ownership in `state.json`.

Uninstalling checks ownership, backs up and removes the entry. **Installed** is built by reading every adapter's config for the global scope and each known project folder.

## Catalog

`Catalog` searches every enabled registry in parallel and merges the pages. Its cursor is a base64 map of per-registry cursors, so paging continues each registry independently. A failure in one registry is reported alongside the results of the others.

`HttpCache` serves fresh cache hits (under ten minutes), otherwise fetches with retries, and falls back to a stale copy if the network fails.

## IPC

`src/shared/api.ts` defines the `KumiApi` interface. The preload exposes exactly those methods as `window.kumi`, each on a `kumi:<method>` channel. `src/main/ipc.ts` validates every argument with zod before calling a service; file paths sent from the window must be absolute and must belong to a known config or backup. Results travel as `{ ok, value }` or `{ ok: false, error }`.
