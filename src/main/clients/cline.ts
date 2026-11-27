import { join } from 'node:path';
import type { ServerSpec } from '@shared/types';
import { anyExists, commonEntry, createJsonAdapter, parseCommonEntry } from './common';
import type { HostEnv } from './types';

/** `~/.cline`, or `$CLINE_DIR`. */
function clineDir(env: HostEnv): string {
  return env.vars.CLINE_DIR?.trim() || join(env.home, '.cline');
}

/**
 * Shared by the Cline CLI and the Cline VS Code extension, which moved off its per-editor globalStorage
 * file and migrates it here.
 */
function settingsPath(env: HostEnv): string {
  const explicit = env.vars.CLINE_MCP_SETTINGS_PATH?.trim();
  if (explicit) return explicit;
  const dataDir = env.vars.CLINE_DATA_DIR?.trim() || join(clineDir(env), 'data');
  return join(dataDir, 'settings', 'cline_mcp_settings.json');
}

type ClineType = 'stdio' | 'sse' | 'streamableHttp' | undefined;

function clineType(e: Record<string, unknown>): ClineType {
  const t = e.type ?? e.transportType;
  if (t === 'http') return 'streamableHttp';
  return t === 'stdio' || t === 'sse' || t === 'streamableHttp' ? t : undefined;
}

/** Reads the legacy flat shape and the newer `{ transport: { type, … } }` one. */
function parse(name: string, raw: unknown): ServerSpec {
  const outer = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const nested = outer.transport && typeof outer.transport === 'object' ? (outer.transport as Record<string, unknown>) : undefined;
  const e = nested ?? outer;
  const spec = parseCommonEntry(name, e);
  if (spec.transport === 'stdio') return spec;
  // Cline treats a `url` without a `type` as the legacy SSE transport.
  return { ...spec, transport: clineType(e) === 'streamableHttp' ? 'streamable-http' : 'sse' };
}

export const cline = createJsonAdapter({
  id: 'cline',
  displayName: 'Cline',
  scopes: ['user'],
  transports: ['stdio', 'streamable-http', 'sse'],
  needsRestart: false,
  configPath: (env) => settingsPath(env),
  detect: async (env) => !!(await env.which('cline')) || anyExists(env, [clineDir(env), settingsPath(env)]),
  serversPath: () => ['mcpServers'],
  parse,
  // `type` is always written: without it Cline would read a `url` as SSE.
  render: (spec) => ({
    entry: commonEntry(spec, (t) => (t === 'stdio' ? 'stdio' : t === 'sse' ? 'sse' : 'streamableHttp')),
    warnings: [],
  }),
});
