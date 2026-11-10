import { join } from 'node:path';
import type { ServerSpec } from '@shared/types';
import { anyExists, createJsonAdapter, requireProjectDir, stringRecord } from './common';
import type { HostEnv } from './types';

// OpenCode uses ~/.config/opencode on every platform (it follows XDG_CONFIG_HOME, not %APPDATA%).
function userDir(env: HostEnv): string {
  return join(env.xdgConfig, 'opencode');
}

/** `{ type: "local", command: [cmd, ...args], environment }` or `{ type: "remote", url, headers }`. */
function render(spec: ServerSpec): Record<string, unknown> {
  if (spec.transport === 'stdio') {
    return {
      type: 'local',
      command: [spec.command, ...(spec.args ?? [])],
      ...(spec.env && Object.keys(spec.env).length ? { environment: spec.env } : {}),
    };
  }
  return {
    type: 'remote',
    url: spec.url,
    ...(spec.headers && Object.keys(spec.headers).length ? { headers: spec.headers } : {}),
  };
}

function parse(name: string, raw: unknown): ServerSpec {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (e.type === 'remote' || typeof e.url === 'string') {
    const headers = stringRecord(e.headers);
    return { name, transport: 'streamable-http', url: typeof e.url === 'string' ? e.url : undefined, ...(headers ? { headers } : {}) };
  }
  const command = Array.isArray(e.command) ? e.command.map(String) : typeof e.command === 'string' ? [e.command] : [];
  const env = stringRecord(e.environment);
  return { name, transport: 'stdio', command: command[0], args: command.slice(1), ...(env ? { env } : {}) };
}

export const opencode = createJsonAdapter({
  id: 'opencode',
  displayName: 'OpenCode',
  scopes: ['user', 'project'],
  // Remote servers use Streamable HTTP only.
  transports: ['stdio', 'streamable-http'],
  bridgeable: ['sse'],
  needsRestart: false,
  configPath: (env, scope) => (scope.kind === 'project' ? join(requireProjectDir(scope), 'opencode.json') : join(userDir(env), 'opencode.json')),
  detect: async (env) => !!(await env.which('opencode')) || anyExists(env, [userDir(env)]),
  serversPath: () => ['mcp', 'servers'],
  render: (spec) => ({ entry: render(spec), warnings: [] }),
  parse,
});
