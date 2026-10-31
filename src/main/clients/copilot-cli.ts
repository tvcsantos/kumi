import { join } from 'node:path';
import type { ServerSpec } from '@shared/types';
import { anyExists, commonEntry, createJsonAdapter, parseCommonEntry } from './common';

export const copilotCli = createJsonAdapter({
  id: 'copilot-cli',
  displayName: 'GitHub Copilot CLI',
  scopes: ['user'],
  transports: ['stdio', 'streamable-http', 'sse'],
  needsRestart: false,
  configPath: (env) => join(env.home, '.copilot', 'mcp-config.json'),
  detect: async (env) => !!(await env.which('copilot')) || anyExists(env, [join(env.home, '.copilot')]),
  serversPath: () => ['mcpServers'],
  render: (spec) => ({
    entry: { ...commonEntry(spec, (t) => (t === 'stdio' ? 'local' : t === 'sse' ? 'sse' : 'http')), tools: ['*'] },
    warnings: [],
  }),
  parse: (name, raw): ServerSpec => parseCommonEntry(name, raw),
});
