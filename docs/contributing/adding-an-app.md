# Adding an app

Each app Kumi supports is one adapter. For an app whose config is a JSON or JSONC object with a map of servers, an adapter is a few lines.

## 1. Find out how the app reads MCP servers

From the app's documentation, and ideally a real config file:

- Where the file lives on macOS, Windows and Linux, and any environment variable that moves it.
- Whether there's a project-level file.
- The key that holds the servers (`mcpServers`, `servers`, …).
- How a stdio entry and a remote entry look, and whether there's a `type` field.
- Which transports it supports: stdio, Streamable HTTP, SSE.
- Whether it needs a restart to pick up changes.

## 2. Add the id

Add the id to `CLIENT_IDS` in `src/shared/types.ts`:

```ts
export const CLIENT_IDS = [/* … */, 'acme-cli'] as const;
```

## 3. Write the adapter

Create `src/main/clients/acme-cli.ts`:

```ts
import { join } from 'node:path';
import { anyExists, commonEntry, createJsonAdapter, requireProjectDir } from './common';
import type { HostEnv } from './types';

function userDir(env: HostEnv): string {
  return env.vars.ACME_HOME ?? join(env.home, '.acme');
}

export const acmeCli = createJsonAdapter({
  id: 'acme-cli',
  displayName: 'Acme CLI',
  scopes: ['user', 'project'],
  // What the app supports natively.
  transports: ['stdio', 'streamable-http'],
  // What Kumi may route through mcp-remote instead.
  bridgeable: ['sse'],
  needsRestart: false,
  configPath: (env, scope) =>
    scope.kind === 'project' ? join(requireProjectDir(scope), '.acme', 'mcp.json') : join(userDir(env), 'mcp.json'),
  detect: async (env) => !!(await env.which('acme')) || anyExists(env, [userDir(env)]),
  serversPath: () => ['mcpServers'],
  // `{ type?, command, args, env }` or `{ type?, url, headers }`.
  render: (spec) => ({
    entry: commonEntry(spec, (t) => (t === 'stdio' ? 'stdio' : 'http')),
    warnings: [],
  }),
});
```

If the app's entry shape differs from the common one, pass your own `render` and `parse` (see `opencode.ts`, where the command is a single array). For extra edits next to the entry, like VS Code's `inputs`, use `afterUpsert`, `afterRemove` and `ignoreInDiff` (see `vscode.ts`). For a non-JSON format, implement `ClientAdapter` directly (see `codex.ts`).

Register it in `src/main/clients/index.ts`:

```ts
export const ADAPTERS: ClientAdapter[] = [/* … */, acmeCli];
```

## 4. Give it a mark

Add a short label and color for the app's badge in `src/renderer/src/components/bits.tsx`. If it has a project-level file, add it to the list in the **Project folders** section of `src/renderer/src/pages/Installed.tsx`.

## 5. Test it

The shared suite in `tests/adapters.test.ts` runs every adapter in `ADAPTERS` through round-trips, bridging and Windows wrapping, so your adapter is covered as soon as it's registered.

Then add golden tests with a real-world config in `tests/fixtures/configs/`:

- Comments, unrelated keys and other servers survive an install.
- Removing the server leaves the rest of the file as it was.
- The exact output for a stdio and a remote server.

```bash
npm test
```

## 6. Document it

Add the app to the README table and to [Supported apps](../reference/apps), with an example of what Kumi writes.
