import { join } from 'node:path';
import { anyExists, commonEntry, createJsonAdapter, requireProjectDir } from './common';
import type { HostEnv } from './types';

function userFile(env: HostEnv): string {
  return join(env.vars.CLAUDE_CONFIG_DIR ?? env.home, '.claude.json');
}

export const claudeCode = createJsonAdapter({
  id: 'claude-code',
  displayName: 'Claude Code',
  scopes: ['user', 'project', 'local'],
  transports: ['stdio', 'streamable-http', 'sse'],
  needsRestart: false,
  configPath: (env, scope) => (scope.kind === 'project' ? join(requireProjectDir(scope), '.mcp.json') : userFile(env)),
  detect: async (env) => !!(await env.which('claude')) || anyExists(env, [userFile(env), join(env.home, '.claude')]),
  // user → top-level mcpServers; local → per-project block inside ~/.claude.json; project → .mcp.json in the repo.
  serversPath: (scope) => (scope.kind === 'local' ? ['projects', requireProjectDir(scope), 'mcpServers'] : ['mcpServers']),
  render: (spec) => ({
    entry: commonEntry(spec, (t) => (t === 'stdio' ? 'stdio' : t === 'sse' ? 'sse' : 'http')),
    warnings: [],
  }),
});
