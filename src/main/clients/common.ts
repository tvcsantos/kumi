import { isDeepStrictEqual } from 'node:util';
import type { JSONPath } from 'jsonc-parser';
import type { ClientId, ScopeKind, ScopeRef, ServerSpec, Transport } from '@shared/types';
import { getAt, parseJson, removeAt, setAt } from '../config-io/json';
import type { ClientAdapter, EditResult, HostEnv, RenderOptions } from './types';

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export function requireProjectDir(scope: ScopeRef): string {
  if (!scope.projectDir) throw new Error(`Scope "${scope.kind}" needs a project folder`);
  return scope.projectDir;
}

const NODE_SHIMS = new Set(['npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bunx']);

/** On Windows, npx & co are .cmd shims that most clients can't spawn directly. */
export function windowsWrap(spec: ServerSpec, platform: NodeJS.Platform): ServerSpec {
  if (platform !== 'win32' || spec.transport !== 'stdio' || !spec.command || !NODE_SHIMS.has(spec.command)) return spec;
  return {
    ...spec,
    command: 'cmd',
    args: ['/c', spec.command, ...(spec.args ?? [])],
    secretArgs: spec.secretArgs?.map((i) => i + 2),
  };
}

/** Runs a remote server through the `mcp-remote` stdio bridge, for clients that can't connect to it directly. */
export function bridgeRemote(spec: ServerSpec): ServerSpec {
  const args = ['-y', 'mcp-remote', spec.url!, '--transport', spec.transport === 'sse' ? 'sse-only' : 'http-only'];
  const env: Record<string, string> = {};
  const secretEnv: string[] = [];
  for (const [name, value] of Object.entries(spec.headers ?? {})) {
    const envName = `MCP_HEADER_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
    // mcp-remote expands ${VAR} itself; keeping the value in env avoids quoting issues with spaces.
    args.push('--header', `${name}:\${${envName}}`);
    env[envName] = value;
    if (spec.secretHeaders?.includes(name)) secretEnv.push(envName);
  }
  return {
    name: spec.name,
    transport: 'stdio',
    command: 'npx',
    args,
    ...(Object.keys(env).length ? { env } : {}),
    ...(secretEnv.length ? { secretEnv } : {}),
  };
}

/** Bridges or rejects transports the client can't handle natively. */
export function adaptTransport(spec: ServerSpec, adapter: Pick<ClientAdapter, 'transports' | 'bridgeable' | 'displayName'>): { spec: ServerSpec; warnings: string[] } {
  if (adapter.transports.includes(spec.transport)) return { spec, warnings: [] };
  if (adapter.bridgeable.includes(spec.transport)) {
    const kind = spec.transport === 'sse' ? 'SSE' : 'remote HTTP';
    return {
      spec: bridgeRemote(spec),
      warnings: [`${adapter.displayName} can't connect to ${kind} servers from its config file, so Kumi routes this one through the mcp-remote bridge (needs Node.js).`],
    };
  }
  throw new UnsupportedError(`${adapter.displayName} doesn't support ${spec.transport} servers.`);
}

export function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
  return Object.keys(out).length ? out : undefined;
}

/** Reads the common `{ type?, command, args, env, url, headers }` entry shape into a ServerSpec. */
export function parseCommonEntry(name: string, raw: unknown): ServerSpec {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const url = typeof e.url === 'string' ? e.url : typeof e.serverUrl === 'string' ? e.serverUrl : undefined;
  if (url) {
    return {
      name,
      transport: e.type === 'sse' ? 'sse' : 'streamable-http',
      url,
      ...(stringRecord(e.headers) ? { headers: stringRecord(e.headers) } : {}),
    };
  }
  return {
    name,
    transport: 'stdio',
    command: typeof e.command === 'string' ? e.command : undefined,
    args: Array.isArray(e.args) ? e.args.map(String) : undefined,
    ...(stringRecord(e.env) ? { env: stringRecord(e.env) } : {}),
  };
}

/** Throws if anything outside the server entry changed; a guard against editing bugs. */
export function assertOnlyServerChanged(
  before: unknown,
  after: unknown,
  serversPath: JSONPath,
  name: string,
  ignore: (root: Record<string, unknown>) => void = () => {},
) {
  const strip = (root: unknown) => {
    const copy = structuredClone(root) as Record<string, unknown>;
    const servers = getAt(copy, serversPath) as Record<string, unknown> | undefined;
    if (servers && typeof servers === 'object') delete servers[name];
    // Containers we create (or empty) along the servers path don't count as a change.
    for (let depth = serversPath.length; depth > 0; depth--) {
      const node = getAt(copy, serversPath.slice(0, depth));
      const parent = getAt(copy, serversPath.slice(0, depth - 1)) as Record<string | number, unknown>;
      if (node && typeof node === 'object' && Object.keys(node).length === 0) delete parent[serversPath[depth - 1]];
      else break;
    }
    ignore(copy);
    return copy;
  };
  if (!isDeepStrictEqual(strip(before), strip(after))) {
    throw new Error('Refusing to write: the edit would change content outside this server entry.');
  }
}

export interface RenderedEntry {
  entry: Record<string, unknown>;
  warnings: string[];
}

interface JsonAdapterDef {
  id: ClientId;
  displayName: string;
  scopes: ScopeKind[];
  transports: Transport[];
  /** Transports reachable via the mcp-remote bridge. */
  bridgeable?: Transport[];
  needsRestart: boolean;
  supportsSecureSecrets?: boolean;
  configPath(env: HostEnv, scope: ScopeRef): string;
  detect(env: HostEnv): Promise<boolean>;
  serversPath(scope: ScopeRef): JSONPath;
  render(spec: ServerSpec, opts: RenderOptions): RenderedEntry;
  parse?(name: string, raw: unknown): ServerSpec;
  /** Extra edits next to the entry, e.g. VS Code `inputs`. Returns the new text. */
  afterUpsert?(text: string, spec: ServerSpec, opts: RenderOptions): string;
  afterRemove?(text: string, name: string): string;
  ignoreInDiff?(root: Record<string, unknown>, name: string): void;
}

/** Builds an adapter for clients whose config is a JSON/JSONC object with a map of servers. */
export function createJsonAdapter(def: JsonAdapterDef): ClientAdapter {
  const parseEntry = def.parse ?? parseCommonEntry;
  const adapter: ClientAdapter = {
    id: def.id,
    displayName: def.displayName,
    scopes: def.scopes,
    transports: def.transports,
    bridgeable: def.bridgeable ?? [],
    needsRestart: def.needsRestart,
    supportsSecureSecrets: !!def.supportsSecureSecrets,
    configPath: def.configPath,
    detect: def.detect,
    readServers(text, scope) {
      const servers = getAt(parseJson(text), def.serversPath(scope));
      if (!servers || typeof servers !== 'object') return {};
      return Object.fromEntries(Object.entries(servers).map(([name, raw]) => [name, parseEntry(name, raw)]));
    },
    upsert(text, spec, scope, opts): EditResult {
      const before = parseJson(text);
      const adapted = adaptTransport(spec, adapter);
      const wrapped = windowsWrap(adapted.spec, opts.platform);
      const { entry, warnings } = def.render(wrapped, opts);
      const path = [...def.serversPath(scope), spec.name];
      let out = setAt(text, path, entry);
      if (def.afterUpsert) out = def.afterUpsert(out, wrapped, opts);
      assertOnlyServerChanged(before, parseJson(out), def.serversPath(scope), spec.name, (root) => def.ignoreInDiff?.(root, spec.name));
      return { text: out, warnings: [...adapted.warnings, ...warnings] };
    },
    remove(text, name, scope) {
      const before = parseJson(text);
      let out = removeAt(text, [...def.serversPath(scope), name]);
      if (def.afterRemove) out = def.afterRemove(out, name);
      assertOnlyServerChanged(before, parseJson(out), def.serversPath(scope), name, (root) => def.ignoreInDiff?.(root, name));
      return out;
    },
  };
  return adapter;
}

/** `{ command, args, env }` or `{ url, headers }`, with optional `type`. */
export function commonEntry(spec: ServerSpec, typeFor: (t: Transport) => string | undefined): Record<string, unknown> {
  const type = typeFor(spec.transport);
  if (spec.transport === 'stdio') {
    return {
      ...(type ? { type } : {}),
      command: spec.command,
      args: spec.args ?? [],
      ...(spec.env && Object.keys(spec.env).length ? { env: spec.env } : {}),
    };
  }
  return {
    ...(type ? { type } : {}),
    url: spec.url,
    ...(spec.headers && Object.keys(spec.headers).length ? { headers: spec.headers } : {}),
  };
}

export async function anyExists(env: HostEnv, paths: string[]): Promise<boolean> {
  for (const p of paths) if (await env.exists(p)) return true;
  return false;
}
