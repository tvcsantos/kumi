import { join } from 'node:path';
import type { ServerSpec } from '@shared/types';
import { isDeepStrictEqual } from 'node:util';
import { getPath, parseToml, removeSections, upsertSection, type TomlTable } from '../config-io/toml';
import { adaptTransport, anyExists, windowsWrap } from './common';
import type { ClientAdapter, HostEnv } from './types';

const ROOT = 'mcp_servers';

function codexHome(env: HostEnv): string {
  return env.vars.CODEX_HOME ?? join(env.home, '.codex');
}

function toTable(spec: ServerSpec): TomlTable {
  if (spec.transport === 'stdio') {
    return {
      command: spec.command,
      args: spec.args ?? [],
      ...(spec.env && Object.keys(spec.env).length ? { env: spec.env } : {}),
    };
  }
  return {
    url: spec.url,
    ...(spec.headers && Object.keys(spec.headers).length ? { http_headers: spec.headers } : {}),
  };
}

function fromTable(name: string, t: TomlTable): ServerSpec {
  const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : undefined);
  if (typeof t.url === 'string') {
    return { name, transport: 'streamable-http', url: t.url, ...(record(t.http_headers) ? { headers: record(t.http_headers) } : {}) };
  }
  return {
    name,
    transport: 'stdio',
    command: typeof t.command === 'string' ? t.command : undefined,
    args: Array.isArray(t.args) ? t.args.map(String) : undefined,
    ...(record(t.env) ? { env: record(t.env) } : {}),
  };
}

/** Everything except our server, for the "nothing else changed" check. */
function withoutServer(text: string, name: string): TomlTable {
  const root = parseToml(text);
  const servers = root[ROOT] as TomlTable | undefined;
  if (servers) {
    delete servers[name];
    if (Object.keys(servers).length === 0) delete root[ROOT];
  }
  return root;
}

function guard(before: string, after: string, name: string) {
  if (!isDeepStrictEqual(withoutServer(before, name), withoutServer(after, name))) {
    throw new Error('Refusing to write: the edit would change content outside this server entry.');
  }
}

export const codex: ClientAdapter = {
  id: 'codex',
  displayName: 'OpenAI Codex',
  scopes: ['user'],
  transports: ['stdio', 'streamable-http'],
  bridgeable: ['sse'],
  needsRestart: false,
  supportsSecureSecrets: false,
  configPath: (env) => join(codexHome(env), 'config.toml'),
  detect: async (env) => !!(await env.which('codex')) || anyExists(env, [codexHome(env)]),
  readServers(text) {
    const servers = getPath(parseToml(text), [ROOT]);
    if (!servers || typeof servers !== 'object') return {};
    return Object.fromEntries(Object.entries(servers as TomlTable).map(([name, t]) => [name, fromTable(name, t as TomlTable)]));
  },
  upsert(text, spec, _scope, opts) {
    const adapted = adaptTransport(spec, codex);
    const out = upsertSection(text, [ROOT, spec.name], toTable(windowsWrap(adapted.spec, opts.platform)));
    guard(text, out, spec.name);
    return { text: out, warnings: adapted.warnings };
  },
  remove(text, name) {
    const out = removeSections(text, [ROOT, name]);
    guard(text, out, name);
    return out;
  },
};
