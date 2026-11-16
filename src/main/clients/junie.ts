import { join } from 'node:path';
import { anyExists, commonEntry, createJsonAdapter, requireProjectDir } from './common';
import type { HostEnv } from './types';

/** Shared by the Junie CLI and the Junie plugin in JetBrains IDEs. */
function junieDir(env: HostEnv): string {
  return join(env.home, '.junie');
}

export const junie = createJsonAdapter({
  id: 'junie',
  displayName: 'Junie',
  scopes: ['user', 'project'],
  // Junie documents only local commands and remote `url`s; SSE isn't documented, so it goes through the bridge.
  transports: ['stdio', 'streamable-http'],
  bridgeable: ['sse'],
  needsRestart: false,
  configPath: (env, scope) =>
    join(scope.kind === 'project' ? join(requireProjectDir(scope), '.junie') : junieDir(env), 'mcp', 'mcp.json'),
  detect: async (env) => !!(await env.which('junie')) || anyExists(env, [junieDir(env)]),
  serversPath: () => ['mcpServers'],
  // `command` selects stdio and `url` selects HTTP, so no `type` is needed.
  render: (spec) => ({ entry: commonEntry(spec, () => undefined), warnings: [] }),
});
