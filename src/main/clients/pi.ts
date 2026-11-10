import { join } from 'node:path';
import { anyExists, commonEntry, createJsonAdapter, requireProjectDir } from './common';
import type { HostEnv } from './types';

function agentDir(env: HostEnv): string {
  return env.vars.PI_CODING_AGENT_DIR ?? join(env.home, '.pi', 'agent');
}

export const pi = createJsonAdapter({
  id: 'pi',
  displayName: 'Pi',
  scopes: ['user', 'project'],
  // Pi's built-in MCP rejects the legacy SSE transport.
  transports: ['stdio', 'streamable-http'],
  bridgeable: ['sse'],
  needsRestart: false,
  configPath: (env, scope) => (scope.kind === 'project' ? join(requireProjectDir(scope), '.pi', 'mcp.json') : join(agentDir(env), 'mcp.json')),
  detect: async (env) => !!(await env.which('pi')) || anyExists(env, [agentDir(env)]),
  serversPath: () => ['mcpServers'],
  // `command` selects stdio and `url` selects Streamable HTTP, so no `type` is needed.
  render: (spec) => ({ entry: commonEntry(spec, () => undefined), warnings: [] }),
});
