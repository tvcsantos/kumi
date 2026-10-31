# Kumi — MCP Marketplace & Manager (Desktop)

> *Kumi* (組): "group, set, team"; also "to assemble" or "to braid", as in *kumihimo*, braided cord. Here, one place that assembles your MCP servers into a single set and weaves it into every AI tool you use.

## 1. Goal

A cross-platform Electron desktop app where users can:

1. **Browse** a catalog of MCP (Model Context Protocol) servers (search, categories, details, README).
2. **Choose target clients**: Claude (Desktop + Code), VS Code, Cursor, OpenAI Codex, GitHub Copilot.
3. **Fill in settings** (env vars, API keys, arguments, URLs, headers) in a form generated from the server's metadata.
4. **Install**: Kumi writes the correct config, in the correct format and location, for each selected client.
5. **Manage**: view what's installed where, edit settings, enable/disable, update, uninstall, and roll back.

### Non-goals (v1)

- Hosting or running MCP servers ourselves. Clients run them; Kumi only configures them.
- Running our own registry backend. We use the official MCP Registry plus a curated overlay.
- Mobile or web versions.

---

## 2. Target clients & config formats

Each client gets an **adapter** that knows where its config lives, its format, and which features it supports. This table is the core domain knowledge; every row needs a fixture-based test suite. Formats change between client releases, so check each against current vendor docs while building its adapter.

| Client | Scope | Path (macOS / Linux / Windows) | Format | Root key | Notes |
|---|---|---|---|---|---|
| **Claude Desktop** | user | `~/Library/Application Support/Claude/claude_desktop_config.json` / `~/.config/Claude/claude_desktop_config.json` / `%APPDATA%\Claude\claude_desktop_config.json` | JSON | `mcpServers` | Mostly stdio. Remote servers through `mcp-remote` or the in-app Connectors UI. Needs an app restart. |
| **Claude Code** | user | `~/.claude.json` | JSON | `mcpServers` (top level) | `type`: `stdio` \| `http` \| `sse`. The file also holds a lot of unrelated state, so patch it surgically. |
| | local | `~/.claude.json` → `projects["<abs path>"].mcpServers` | JSON | | Per-project, private to the user. |
| | project | `<repo>/.mcp.json` | JSON | `mcpServers` | Shared through git. Supports `${VAR}` expansion. |
| | (alt) | `claude mcp add-json <name> '<json>' --scope …` | CLI | | Preferred path when the `claude` CLI is on PATH. |
| **VS Code** (incl. **GitHub Copilot** agent mode) | user | `~/Library/Application Support/Code/User/mcp.json` (+ `Code - Insiders`, profiles) | **JSONC** | `servers` (+ `inputs`) | Has `inputs` with `promptString` + `password: true`, so VS Code prompts for secrets and stores them itself. |
| | workspace | `<repo>/.vscode/mcp.json` | JSONC | `servers` | |
| | (alt) | `code --add-mcp '<json>'` | CLI | | |
| **Cursor** | user | `~/.cursor/mcp.json` | JSON | `mcpServers` | Remote: `url` + `headers`. |
| | project | `<repo>/.cursor/mcp.json` | JSON | `mcpServers` | |
| **OpenAI Codex** (CLI / IDE ext) | user | `~/.codex/config.toml` (or `$CODEX_HOME`) | **TOML** | `[mcp_servers.<name>]` | `command`, `args`, `env`, `env_vars` (pass-through), `url`, `bearer_token_env_var`, timeouts. |
| | (alt) | `codex mcp add <name> -- <cmd>` | CLI | | |
| **GitHub Copilot CLI** | user | `~/.copilot/mcp-config.json` | JSON | `mcpServers` | Separate from VS Code. |
| **Copilot in JetBrains / Visual Studio** | user/sln | JetBrains: `mcp.json` under the Copilot plugin config dir; VS: `.mcp.json` / `%USERPROFILE%\.mcp.json` | JSON | `servers` | Phase 3. |

Clients to consider later: Windsurf, Zed, Cline/Roo, Gemini CLI, Continue, LM Studio, Goose. The adapter design makes each one about a day of work.

### Key takeaways

- **Three formats**: JSON, JSONC (with comments), and TOML. All writes must **preserve formatting, comments, and unknown keys**.
- **Different schemas for the same thing**: `mcpServers` vs `servers`, `type` field present or absent, `url` vs `serverUrl`, and so on. So Kumi needs a **canonical internal model** with one renderer per client.
- **Scopes**: user (global) vs project/workspace vs local. The UI must let the user pick a scope and, for project scope, a folder.
- **Some clients ship a CLI** (`claude mcp`, `code --add-mcp`, `codex mcp`). Prefer the CLI when it exists because the vendor keeps it compatible. Fall back to direct file editing.

---

## 3. Catalog / data source

### Primary: Official MCP Registry
- API: `https://registry.modelcontextprotocol.io/v0/servers` (paginated with a cursor, supports `search`, and returns versions).
- Each entry is a `server.json` with:
  - `packages[]`: `registryType` (`npm`, `pypi`, `oci`, `nuget`, `mcpb`), `identifier`, `version`, `transport`, `runtimeHint` (`npx`, `uvx`, `docker`, …), `runtimeArguments`, `packageArguments`, and **`environmentVariables[]`** (`name`, `description`, `isRequired`, `isSecret`, `default`, `format`, `choices`).
  - `remotes[]`: `type` (`streamable-http` \| `sse`), `url`, and `headers[]` (with the same input metadata as env vars).
- **The install form is generated from these fields**, so no hand-written forms are needed for most servers.

### Secondary: Kumi curated overlay (a JSON file in a GitHub repo, fetched and cached)
- Featured servers, categories and tags, icons, screenshots, a "verified" badge, better descriptions.
- **Overrides and fixes** for servers with incomplete `server.json` (missing env vars, wrong runtime hints).
- Per-client compatibility notes, for example "Claude Desktop needs `mcp-remote` for this remote server".

### Tertiary
- User-added **custom servers** (paste JSON, point at a local command, or enter a remote URL).
- **Additional registries** (company-internal registries implementing the same API). Configurable in Settings.

Cache the catalog locally (SQLite or JSON) for offline browsing and fast search. Refresh in the background.

---

## 4. Architecture

```
┌─────────────────────────── Electron ───────────────────────────┐
│ Renderer (React + TS, sandboxed, contextIsolation)             │
│   Catalog · Server detail · Install wizard · Installed · Settings│
│                 │  typed IPC (zod-validated)                   │
│ Preload  ── exposes `window.kumi.*` (narrow API only)         │
│                 │                                              │
│ Main process (Node)                                            │
│  ├─ CatalogService     registry client + overlay + cache       │
│  ├─ ClientRegistry     detect installed clients                │
│  ├─ Adapters/          claude-desktop, claude-code, vscode,    │
│  │                     cursor, codex, copilot-cli, …           │
│  ├─ ConfigIO           JSON / JSONC / TOML format-preserving   │
│  ├─ InstallService     plan → diff → backup → apply → verify   │
│  ├─ SecretsService     OS keychain (safeStorage / keytar)      │
│  ├─ RuntimeService     detect node/npx, uv/uvx, docker, python │
│  ├─ HealthService      spawn + MCP handshake (tools/list)      │
│  ├─ StateStore         ~/.kumi/state.json (what we installed)   │
│  └─ BackupService      timestamped backups + restore           │
└────────────────────────────────────────────────────────────────┘
```

### Tech stack
- **Electron** + **electron-vite** (Vite for main, preload, and renderer), **TypeScript** everywhere.
- **React** + **TanStack Query** (async state) + **Tailwind** + **shadcn/ui** (or Radix) for UI.
- **Forms**: `react-hook-form` + `zod`. The schema is built at runtime from `environmentVariables`, `packageArguments`, and `headers`.
- **Config I/O**:
  - JSON / JSONC: `jsonc-parser` (`modify` + `applyEdits` preserves comments and formatting).
  - TOML: a format-preserving editor (`@decimalturn/toml-patch` / `toml-patch`), with `smol-toml` for parsing and validation.
- **MCP client** for health checks: `@modelcontextprotocol/sdk`.
- **Secrets**: Electron `safeStorage` for at-rest encryption of Kumi's own store, and the OS keychain for secure-launch mode (see §6).
- **Packaging**: `electron-builder` (dmg / nsis / AppImage + deb), `electron-updater` for auto-update, code signing plus macOS notarization.
- **Testing**: Vitest (unit + adapter fixtures), Playwright for Electron (E2E).
- **Lint/format**: ESLint + Prettier (or Biome).

### Canonical model

```ts
type Transport = 'stdio' | 'streamable-http' | 'sse';

interface ServerSpec {
  name: string;                      // config key, e.g. "github"
  transport: Transport;
  // stdio
  command?: string;                  // "npx" | "uvx" | "docker" | abs path
  args?: string[];
  env?: Record<string, SecretRef | string>;
  cwd?: string;
  // remote
  url?: string;
  headers?: Record<string, SecretRef | string>;
  // provenance
  source: { registry: string; id: string; version: string } | { custom: true };
}

type SecretRef = { secret: string };  // key into SecretsService

interface ClientAdapter {
  id: ClientId;                      // 'claude-desktop' | 'claude-code' | 'vscode' | ...
  displayName: string;
  scopes: Scope[];                   // 'user' | 'project' | 'local'
  detect(): Promise<Detection>;      // installed? version? config paths?
  capabilities: {
    transports: Transport[];
    envInterpolation: boolean;       // e.g. ${VAR} in .mcp.json
    secretInputs: boolean;           // VS Code `inputs`
    needsRestart: boolean;
    cli?: { bin: string };
  };
  list(scope: ScopeRef): Promise<InstalledEntry[]>;     // read existing (incl. not-ours)
  render(spec: ServerSpec, scope: ScopeRef): ConfigPatch; // canonical → client format
  apply(patch: ConfigPatch): Promise<ApplyResult>;      // write (CLI or file)
  remove(name: string, scope: ScopeRef): Promise<void>;
  parse(raw: unknown): ServerSpec;   // client format → canonical (for import/edit)
}
```

When a client doesn't support a transport (for example a remote server on Claude Desktop), the adapter either **adapts** it (wrap with `npx mcp-remote <url>`) or marks the client **incompatible** in the UI and explains why.

---

## 5. Install flow (UX)

1. **Catalog**: search, filters (category, transport, runtime, verified), and cards with icon, name, short description, and badges.
2. **Server detail**: README, tools exposed (from registry metadata or a cached health check), required env vars, source repo, version, license.
3. **Click "Install"** to open the wizard:
   1. **Pick clients**: checkboxes for detected clients. Undetected ones are greyed out with an "install it" link. Show compatibility per client.
   2. **Pick scope** per client: User (global), or Project (folder picker), or Local for Claude Code.
   3. **Pick a package/remote variant** if there are several (for example `npx` vs `docker` vs hosted remote).
   4. **Configure**: an auto-generated form with required/optional fields, secrets masked, defaults filled, inline validation (format, choices), and help text from descriptions. Also an editable server name (the config key) with collision detection.
   5. **Prerequisites check**: is `npx`/`uvx`/`docker` available? If not, show how to install it.
   6. **Review**: a per-file **diff preview** of exactly what will change in each config file. Secrets are masked in the preview.
   7. **Apply**: back up each file → write → re-read and validate → record in StateStore.
   8. **Result**: success per client, a "Restart Claude Desktop" hint or button where needed, and an optional **Test connection** step.
4. **Installed view**: a matrix of servers × clients with status. Supports edit settings (re-runs the wizard prefilled), enable/disable, uninstall per client or everywhere, update when a new version is available, and open the config file.
5. **Import / discover**: on first run, scan all client configs and show servers the user installed by hand. Offer to "adopt" them into Kumi or sync them to other clients ("copy my Cursor servers to Claude Code").

---

## 6. Secrets strategy

Most clients expect secret values **inline in their config file** (plaintext). Kumi offers modes, chosen per install with a sensible default:

| Mode | How | Pros | Cons |
|---|---|---|---|
| **Inline** (default for most clients) | Write the value into the client config | Works everywhere | Plaintext on disk (same as manual setup) |
| **Client-native secure** | VS Code: `inputs` + `password: true` (VS Code prompts and stores). Codex: `env_vars` / `bearer_token_env_var` pass-through. `.mcp.json`: `${VAR}` | No plaintext written by Kumi | Only some clients; the user must provide the env or a prompt |
| **Kumi secure launch** (opt-in) | Config points to `kumi-run <server-id>`, a small launcher that pulls secrets from the OS keychain and `exec`s the real command with env injected | No plaintext, one place to rotate keys | Extra moving part; stdio only; the launcher must be installed on PATH |

Rules:
- Never log secret values. Mask them in diffs, backups metadata, and the UI.
- Kumi's own state stores only `SecretRef`s. Values live in the keychain.
- Show the user clearly which mode is in use and where the secret ends up.

---

## 7. Safe config editing (critical)

Users' config files hold hand-tuned state. Breaking them destroys trust.

- **Read → modify AST → write**. Never regenerate a whole file. Preserve comments, ordering, whitespace, and unknown keys.
- **Atomic writes**: write a temp file in the same dir, `fsync`, then `rename`. Keep the original file mode.
- **Backups** before every write: `~/.kumi/backups/<client>/<timestamp>-<file>`, with retention N=20 and one-click restore in the UI.
- **Concurrency**: check mtime/hash between plan and apply. If the file changed, re-plan and re-show the diff.
- **Ownership tracking** (`~/.kumi/state.json`): record which entries Kumi created (client, scope, path, key, spec hash). Never delete or modify entries Kumi doesn't own without explicit confirmation.
- **Validation after write**: re-parse, confirm the entry round-trips through `adapter.parse`.
- **Large, shared files** (`~/.claude.json` is constantly rewritten by Claude Code): prefer the `claude` CLI when available. Otherwise do a minimal JSON patch with a retry on conflict, and warn if Claude Code is running.
- **File watching** (chokidar): refresh the Installed view when configs change externally.

---

## 8. Health check / "Test connection"

- For stdio: spawn the command with the resolved env, perform the MCP `initialize` handshake, call `tools/list`, then shut down. Enforce a timeout and capture stderr for diagnostics.
- For remote: connect with Streamable HTTP (fall back to SSE) and send headers.
- Show the tool list, server info and version, and errors with friendly hints ("401: check your API key", "npx not found").
- Warn clearly that this **runs the server's code locally**.
- OAuth-based remote servers: v1 shows "auth happens in the client". Later, Kumi could support the MCP OAuth flow for testing.

---

## 9. Security considerations

- Installing an MCP server means **running third-party code** with the user's privileges. Show the publisher, source repo, registry verification status, and the exact command before install. Pin versions (`pkg@1.2.3`) by default, with "latest" opt-in.
- Electron hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a strict CSP, no remote content in privileged windows, and README markdown sanitized (`DOMPurify`) with external links opened in the browser.
- IPC: narrow, typed, zod-validated. The renderer never sends arbitrary file paths or shell commands to main.
- Spawning: use `execFile`/`spawn` with arg arrays, never shell strings.
- Overlay and registry data are untrusted input. Validate them against the schema.
- Signed builds and signed auto-updates.

---

## 10. Project structure

```
kumi/
├─ PLAN.md
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ src/
│  ├─ main/
│  │  ├─ index.ts                 # app lifecycle, windows
│  │  ├─ ipc/                     # handlers + zod schemas
│  │  ├─ catalog/                 # registry client, overlay, cache
│  │  ├─ clients/
│  │  │  ├─ types.ts              # ClientAdapter, ServerSpec
│  │  │  ├─ claude-desktop.ts
│  │  │  ├─ claude-code.ts
│  │  │  ├─ vscode.ts
│  │  │  ├─ cursor.ts
│  │  │  ├─ codex.ts
│  │  │  └─ copilot-cli.ts
│  │  ├─ config-io/               # json.ts, jsonc.ts, toml.ts, atomic-write.ts
│  │  ├─ install/                 # planner, diff, apply, rollback
│  │  ├─ secrets/
│  │  ├─ runtime/                 # detect npx/uvx/docker
│  │  ├─ health/                  # MCP handshake
│  │  └─ state/                   # state.json, backups
│  ├─ preload/
│  │  └─ index.ts
│  ├─ renderer/
│  │  ├─ routes/                  # Catalog, ServerDetail, Installed, Settings
│  │  ├─ components/              # InstallWizard, DynamicForm, DiffView, ClientPicker
│  │  └─ lib/
│  └─ shared/                     # types shared across processes
├─ packages/
│  └─ kumi-run/                  # secure-launch shim (phase 3)
└─ tests/
   ├─ fixtures/<client>/*.json|jsonc|toml   # real-world config samples
   ├─ unit/
   └─ e2e/
```

---

## 11. Roadmap

> **Status (2026-10-29):** Phase 0 and the Phase 1 MVP are implemented, plus parts of Phase 2 (health check, Copilot CLI, mcp-remote bridging). Decisions made while building:
> - The registry API is `https://registry.modelcontextprotocol.io/v0.1` (`/v0` timed out). Some lookups take ~15s, so the client uses a 25s timeout and a disk cache, and featured cards load one by one.
> - JSON/JSONC edits use `jsonc-parser`. Comments and unrelated keys survive, but lines next to the edit may be reformatted. Byte-identical preservation holds for TOML (Codex), where Kumi owns whole sections. Every write is checked so that nothing outside the server entry changes.
> - Edits are written directly to config files. Vendor CLIs (`claude mcp`, `code --add-mcp`, `codex mcp`) are not used yet.
> - On launch, `PATH`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `XDG_CONFIG_HOME` are read from the user's login shell, because GUI launches don't inherit them.

### Phase 0: Foundations (≈1 week)
- [x] Scaffold electron-vite + React + TS + Tailwind/shadcn. Set up ESLint/Prettier and Vitest.
- [x] Electron security baseline (sandbox, CSP, typed IPC bridge).
- [x] CI: GitHub Actions matrix (macOS, Windows, Linux) running lint, typecheck, and tests.
- [x] `config-io`: format-preserving JSON, JSONC, and TOML edit with atomic write and backup, plus heavy tests.

### Phase 1: MVP (≈3–4 weeks)
- [x] Canonical `ServerSpec` and `ClientAdapter` interface.
- [x] Adapters: **Claude Desktop, Claude Code (user + project), VS Code (user + workspace), Cursor (user + project), Codex (user)**, each with detect, list, render, apply, remove, and fixture tests.
- [x] Catalog: official registry client, local cache, search, and the detail page.
- [x] Dynamic form from `environmentVariables`, `packageArguments`, and `headers`.
- [x] Install wizard: clients → scope → configure → prereqs → diff → apply.
- [x] Installed view: matrix, uninstall, edit, open config, restore backup.
- [x] StateStore and ownership tracking.
- [x] Inline secrets mode, plus VS Code `inputs` mode.
- [ ] Unsigned dev builds for all three OSes.

### Phase 2: Polish & trust (≈2–3 weeks)
- [ ] Curated overlay repo (started: featured list and categories ship with the app in `src/shared/featured.ts`) (featured, categories, icons, overrides, verified).
- [x] Health check / Test connection.
- [ ] Import existing servers (done: hand-added servers are listed, and editing one adopts it), adopt them, and "copy to other clients".
- [ ] Update detection (new registry version → update across clients).
- [x] GitHub Copilot CLI adapter. Use CLIs (`claude mcp`, `code --add-mcp`, `codex mcp`) when present.
- [x] Remote-server bridging for stdio-only clients (`mcp-remote`).
- [ ] Code signing, notarization, auto-update, release pipeline.

### Phase 3: Power features
- [ ] `kumi-run` secure-launch shim with OS keychain.
- [ ] More clients: Windsurf, Zed, Cline, Gemini CLI, JetBrains/Visual Studio Copilot, Continue.
- [ ] Profiles / bundles ("Web dev pack": install N servers at once) and export/import of a setup.
- [ ] Custom/private registries (enterprise).
- [ ] Deep links: `kumi://install?server=io.github.foo/bar`, so websites can show an "Install with Kumi" button.
- [ ] Companion `kumi` CLI for headless and CI use.

---

## 12. Testing strategy

- **Adapter golden tests**: for each client, fixtures covering empty, minimal, with comments, with unrelated keys, with conflicting names, and malformed files. Assert on the exact output text so formatting is preserved.
- **Round-trip property tests**: `parse(render(spec)) == spec` for every adapter.
- **Install service**: plan, apply, and rollback on a temp home dir (`HOME` overridden), including the concurrent-modification case.
- **Catalog**: contract tests against recorded registry responses, plus schema validation.
- **E2E (Playwright + Electron)**: browse → install into a fake home → assert files written → uninstall → assert clean.
- **Manual smoke matrix** per release: actually open each real client and confirm the server shows up and works.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Client config formats change without notice | Adapters are isolated and versioned, prefer vendor CLIs, fixture tests, and a fast release cadence. Detect the client version and warn on unknown versions. |
| Corrupting a user's config | Format-preserving edits, atomic writes, backups, diff preview, ownership tracking. |
| `~/.claude.json` races with a running Claude Code | Use the `claude` CLI, retry on conflict, warn if the process is running. |
| Plaintext secrets | Secure modes (§6), clear disclosure. |
| Malicious or low-quality servers in the registry | Verified badges, publisher info, pinned versions, a curated overlay with denylist support. |
| Incomplete registry metadata (missing env vars) | Overlay overrides, plus a "custom field" escape hatch in the form. |
| Windows path and quoting quirks (`npx` → `npx.cmd`, `cmd /c`) | Per-OS command rendering in adapters, plus Windows CI. |

---

## 14. Open questions

1. **Distribution**: GitHub Releases only, or also Homebrew cask, winget, and Snap/Flatpak?
2. **Catalog scope**: official registry only, or also index other sources (Smithery, Glama, mcp.so) where their terms allow?
3. **Default secrets mode**: inline (max compatibility) or client-native secure where available?
4. **Claude Code scope default**: user, or ask every time?
5. **Telemetry**: none, or opt-in anonymous install counts (useful for "popular" ranking)?
6. **License** for Kumi itself (MIT / Apache-2.0)?
7. **Branding / UI direction**: a stall/market metaphor, light and dark themes.

---

## 15. Definition of done (MVP)

A user on macOS, Windows, or Linux can open Kumi, search "github", click Install, tick Claude Code + Cursor + VS Code, paste a token, review the diff, and click Apply. Then the GitHub MCP server works in all three tools without the user touching a config file, and they can uninstall it from all three with one click, leaving their configs otherwise byte-identical.
