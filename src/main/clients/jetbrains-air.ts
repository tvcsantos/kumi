import { join } from 'node:path';
import { anyExists, commonEntry, createJsonAdapter } from './common';
import type { HostEnv } from './types';

function jetbrainsDir(env: HostEnv): string {
  return join(env.home, '.jetbrains');
}

/** Air in JetBrains IDEs (the IDE plugin), not the standalone Air app. */
export const jetbrainsAir = createJsonAdapter({
  id: 'jetbrains-air',
  displayName: 'Air in JetBrains IDEs',
  // The plugin reads a single global file; there's no project-level MCP file.
  scopes: ['user'],
  // Air in IDEs supports stdio and HTTP, and explicitly not SSE.
  transports: ['stdio', 'streamable-http'],
  bridgeable: ['sse'],
  // Changes apply to the next agent session, no IDE restart needed.
  needsRestart: false,
  configPath: (env) => join(jetbrainsDir(env), 'mcp', 'mcp.json'),
  detect: (env) => anyExists(env, [jetbrainsDir(env)]),
  serversPath: () => ['mcpServers'],
  // `command` selects stdio and `url` selects HTTP, so no `type` is needed.
  render: (spec) => ({ entry: commonEntry(spec, () => undefined), warnings: [] }),
});
