# Development

Kumi is an [Electron](https://www.electronjs.org) app written in TypeScript, built with [electron-vite](https://electron-vite.org), with a React UI.

## Setup

You need Node.js 24 and npm.

```bash
git clone https://github.com/tvcsantos/kumi.git
cd kumi
npm install
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload. |
| `npm test` | Unit and integration tests (Vitest). |
| `npm run test:watch` | Tests in watch mode. |
| `npm run typecheck` | Type-check the main/preload and renderer projects. |
| `npm run build` | Build the app into `out/`. |
| `npm run dist` | Build and package installers for your platform into `dist/`. |
| `npm run dist:dir` | Build an unpacked app, without installers (faster). |
| `npm run icon` | Regenerate `build/icon.png` and `build/icon.icns` from `build/icon.svg`. |
| `npm run docs:dev` | Run this documentation site locally (see [Documentation](#documentation)). |
| `npm run docs:build` | Build the documentation site into `docs/.vitepress/dist/`. |

## Don't touch your real configs

`npm run dev` reads and writes your real app configs. To work against a throwaway home instead:

```bash
env -u CLAUDE_CONFIG_DIR -u CODEX_HOME -u XDG_CONFIG_HOME -u PI_CODING_AGENT_DIR \
  HOME=/tmp/kumi-home KUMI_DATA_DIR=/tmp/kumi-home/.kumi npm run dev
```

Every path Kumi uses comes from `HOME`, the variables above, and `KUMI_DATA_DIR`. See [Environment variables](../reference/environment).

## Project layout

```
src/shared/      types, registry schema, variant → ServerSpec resolution (used by both processes)
src/main/        Electron main: app adapters, config I/O (JSON/JSONC/TOML), install planner,
                 registry clients (API and static file), backups, state, health check, IPC
src/preload/     the narrow `window.kumi` bridge
src/renderer/    React UI
tests/           Vitest suites with real-world config and registry fixtures
docs/            this site (VitePress, its own npm package); docs/screenshots also feeds the README
```

See [Architecture](./architecture) for how the pieces fit together.

## Tests

Tests live in `tests/` and run in Node, without Electron:

| Suite | Covers |
|---|---|
| `adapters.test.ts` | Every app adapter: round-trips, bridging, Windows wrapping, and golden tests against fixture configs. |
| `config-io.test.ts` | Format-preserving JSON/JSONC/TOML edits, atomic writes. |
| `install-service.test.ts` | Plan, apply, uninstall and backups on a temporary home, including a file changing between plan and apply. |
| `catalog.test.ts` | Registry clients, merged search, registry storage and headers. |
| `variants.test.ts` | `server.json` → form fields → `ServerSpec`. |

Fixtures in `tests/fixtures/` are real-world config samples. They're compared byte for byte, so `.gitattributes` keeps them LF on every platform.

CI runs typecheck, tests and build on macOS, Windows and Linux for every push and pull request.

## Screenshots

`docs/screenshots/` holds a light and a dark version of each screenshot (`name.png` and `name-dark.png`). The README shows the one that matches the reader's GitHub theme, and so does this site. Keep both when you update one.

## Documentation

The docs are a [VitePress](https://vitepress.dev) site in `docs/`, with their own `package.json` and lockfile, so the app doesn't depend on VitePress and the docs don't need Electron. Install them once:

```bash
npm --prefix docs install
```

Then run `npm run docs:dev` from the repository root (or `npm run dev` inside `docs/`) and open the URL it prints. Pushing to `main` publishes the site to GitHub Pages.
