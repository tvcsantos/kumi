import { join } from 'node:path';
import { anyExists, commonEntry, createJsonAdapter } from './common';
import type { HostEnv } from './types';

function configDir(env: HostEnv): string {
  if (env.platform === 'darwin') return join(env.home, 'Library', 'Application Support', 'Claude');
  if (env.platform === 'win32') return join(env.appData, 'Claude');
  return join(env.xdgConfig, 'Claude');
}

export const claudeDesktop = createJsonAdapter({
  id: 'claude-desktop',
  displayName: 'Claude Desktop',
  scopes: ['user'],
  transports: ['stdio'],
  // Remote servers are added as Connectors in the app; from the config file they go through mcp-remote.
  bridgeable: ['streamable-http', 'sse'],
  needsRestart: true,
  configPath: (env) => join(configDir(env), 'claude_desktop_config.json'),
  detect: (env) =>
    anyExists(env, [
      configDir(env),
      ...(env.platform === 'darwin' ? ['/Applications/Claude.app', join(env.home, 'Applications', 'Claude.app')] : []),
      ...(env.platform === 'win32' ? [join(env.localAppData, 'AnthropicClaude')] : []),
    ]),
  serversPath: () => ['mcpServers'],
  render: (spec) => ({ entry: commonEntry(spec, () => undefined), warnings: [] }),
});
