import { join } from 'node:path';
import { anyExists, commonEntry, createJsonAdapter, requireProjectDir } from './common';
import type { HostEnv } from './types';

// Zed uses ~/.config/zed on macOS regardless of $XDG_CONFIG_HOME, follows it on Linux, and %APPDATA%\Zed on Windows.
function userDir(env: HostEnv): string {
  if (env.platform === 'darwin') return join(env.home, '.config', 'zed');
  if (env.platform === 'win32') return join(env.appData, 'Zed');
  return join(env.xdgConfig, 'zed');
}

/** MCP servers live under `context_servers` in Zed's settings.json, next to every other setting. */
export const zed = createJsonAdapter({
  id: 'zed',
  displayName: 'Zed',
  scopes: ['user', 'project'],
  // Remote servers use Streamable HTTP only.
  transports: ['stdio', 'streamable-http'],
  bridgeable: ['sse'],
  // Zed watches its settings and restarts context servers when they change.
  needsRestart: false,
  configPath: (env, scope) => (scope.kind === 'project' ? join(requireProjectDir(scope), '.zed', 'settings.json') : join(userDir(env), 'settings.json')),
  detect: async (env) =>
    !!(await env.which('zed')) || anyExists(env, [userDir(env), ...(env.platform === 'darwin' ? ['/Applications/Zed.app'] : [])]),
  serversPath: () => ['context_servers'],
  // `command` selects stdio and `url` selects HTTP, so no `type` is needed.
  render: (spec) => ({ entry: commonEntry(spec, () => undefined), warnings: [] }),
});
