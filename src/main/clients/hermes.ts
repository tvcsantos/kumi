import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { ServerSpec } from '@shared/types';
import { parseYaml, removeEntry, upsertEntry, type YamlMap } from '../config-io/yaml';
import { adaptTransport, anyExists, stringRecord } from './common';
import type { ClientAdapter, HostEnv } from './types';

const ROOT = 'mcp_servers';

/** `$HERMES_HOME`, else `%LOCALAPPDATA%\hermes` on Windows and `~/.hermes` elsewhere (as `hermes_constants` resolves it). */
function hermesHome(env: HostEnv): string {
  const override = env.vars.HERMES_HOME?.trim();
  if (override) return override.replace(/^~(?=$|[\\/])/, env.home);
  if (env.platform === 'win32') return join(env.localAppData || join(env.home, 'AppData', 'Local'), 'hermes');
  return join(env.home, '.hermes');
}

/** `{ command, args, env }`, or `{ url, headers }` with `transport: sse` for legacy SSE servers. */
function toEntry(spec: ServerSpec): YamlMap {
  if (spec.transport === 'stdio') {
    return {
      command: spec.command,
      args: spec.args ?? [],
      ...(spec.env && Object.keys(spec.env).length ? { env: spec.env } : {}),
    };
  }
  return {
    url: spec.url,
    ...(spec.transport === 'sse' ? { transport: 'sse' } : {}),
    ...(spec.headers && Object.keys(spec.headers).length ? { headers: spec.headers } : {}),
  };
}

function fromEntry(name: string, raw: unknown): ServerSpec {
  const e = (raw && typeof raw === 'object' ? raw : {}) as YamlMap;
  if (typeof e.url === 'string') {
    const headers = stringRecord(e.headers);
    return { name, transport: e.transport === 'sse' ? 'sse' : 'streamable-http', url: e.url, ...(headers ? { headers } : {}) };
  }
  const env = stringRecord(e.env);
  return {
    name,
    transport: 'stdio',
    command: typeof e.command === 'string' ? e.command : undefined,
    args: Array.isArray(e.args) ? e.args.map(String) : undefined,
    ...(env ? { env } : {}),
  };
}

/** Everything except our server, for the "nothing else changed" check. */
function withoutServer(text: string, name: string): YamlMap {
  const root = parseYaml(text);
  const servers = root[ROOT] as YamlMap | null | undefined;
  if (servers && typeof servers === 'object') delete servers[name];
  if (servers === null || (servers && typeof servers === 'object' && Object.keys(servers).length === 0)) delete root[ROOT];
  return root;
}

function guard(before: string, after: string, name: string, expected?: YamlMap) {
  const written = (parseYaml(after)[ROOT] as YamlMap | null | undefined)?.[name];
  const entryOk = expected ? isDeepStrictEqual(written, JSON.parse(JSON.stringify(expected))) : written === undefined;
  if (!entryOk || !isDeepStrictEqual(withoutServer(before, name), withoutServer(after, name))) {
    throw new Error('Refusing to write: the edit would change content outside this server entry.');
  }
}

export const hermes: ClientAdapter = {
  id: 'hermes',
  displayName: 'Hermes Agent',
  scopes: ['user'],
  transports: ['stdio', 'streamable-http', 'sse'],
  bridgeable: [],
  // The gateway watches config.yaml; a running CLI session picks changes up with /reload-mcp.
  needsRestart: false,
  supportsSecureSecrets: false,
  configPath: (env) => join(hermesHome(env), 'config.yaml'),
  detect: async (env) => !!(await env.which('hermes')) || anyExists(env, [hermesHome(env)]),
  readServers(text) {
    const servers = parseYaml(text)[ROOT];
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
    return Object.fromEntries(Object.entries(servers).map(([name, raw]) => [name, fromEntry(name, raw)]));
  },
  // No Windows `cmd /c` wrapping: Hermes resolves `npx` through PATHEXT itself, and its malware preflight and
  // npx cache only recognise the command when it's `npx`.
  upsert(text, spec) {
    const adapted = adaptTransport(spec, hermes);
    const entry = toEntry(adapted.spec);
    const out = upsertEntry(text, ROOT, spec.name, entry);
    guard(text, out, spec.name, entry);
    return { text: out, warnings: adapted.warnings };
  },
  remove(text, name) {
    const out = removeEntry(text, ROOT, name);
    guard(text, out, name);
    return out;
  },
};
