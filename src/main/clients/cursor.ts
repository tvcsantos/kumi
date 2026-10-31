import { join } from 'node:path';
import { anyExists, commonEntry, createJsonAdapter, requireProjectDir } from './common';

export const cursor = createJsonAdapter({
  id: 'cursor',
  displayName: 'Cursor',
  scopes: ['user', 'project'],
  transports: ['stdio', 'streamable-http', 'sse'],
  needsRestart: false,
  configPath: (env, scope) => join(scope.kind === 'project' ? requireProjectDir(scope) : env.home, '.cursor', 'mcp.json'),
  detect: async (env) =>
    !!(await env.which('cursor')) ||
    anyExists(env, [join(env.home, '.cursor'), ...(env.platform === 'darwin' ? ['/Applications/Cursor.app'] : [])]),
  serversPath: () => ['mcpServers'],
  // Cursor detects streamable HTTP vs SSE from the URL itself.
  render: (spec) => ({ entry: commonEntry(spec, () => undefined), warnings: [] }),
});
