import { join } from 'node:path';
import type { ServerSpec } from '@shared/types';
import { getAt, parseJson, setAt } from '../config-io/json';
import { anyExists, commonEntry, createJsonAdapter, requireProjectDir } from './common';
import type { HostEnv, RenderOptions } from './types';

function userDir(env: HostEnv): string {
  if (env.platform === 'darwin') return join(env.home, 'Library', 'Application Support', 'Code', 'User');
  if (env.platform === 'win32') return join(env.appData, 'Code', 'User');
  return join(env.xdgConfig, 'Code', 'User');
}

const inputPrefix = (name: string) => `kumi.${name}.`;

interface Input {
  id?: string;
  [k: string]: unknown;
}

/** With client-native secrets, VS Code prompts for each secret once and keeps it in its own secret storage. */
function secretInputs(spec: ServerSpec, opts: RenderOptions): { spec: ServerSpec; inputs: Input[] } {
  if (opts.secretsMode !== 'client-native') return { spec, inputs: [] };
  const inputs: Input[] = [];
  const out: ServerSpec = { ...spec };
  const swap = (record: Record<string, string> | undefined, keys: string[] | undefined, kind: string) => {
    if (!record || !keys?.length) return record;
    const copy = { ...record };
    for (const key of keys) {
      if (!(key in copy)) continue;
      const id = `${inputPrefix(spec.name)}${key}`;
      inputs.push({ type: 'promptString', id, description: `${key} (${kind}) for MCP server "${spec.name}"`, password: true });
      copy[key] = `\${input:${id}}`;
    }
    return copy;
  };
  out.env = swap(spec.env, spec.secretEnv, 'environment variable');
  out.headers = swap(spec.headers, spec.secretHeaders, 'header');
  return { spec: out, inputs };
}

function removeOurInputs(text: string, name: string): string {
  let out = text;
  const inputs = getAt(parseJson(out), ['inputs']);
  if (!Array.isArray(inputs)) return out;
  for (let i = inputs.length - 1; i >= 0; i--) {
    const id = (inputs[i] as Input | null)?.id;
    if (typeof id === 'string' && id.startsWith(inputPrefix(name))) out = setAt(out, ['inputs', i], undefined);
  }
  return out;
}

export const vscode = createJsonAdapter({
  id: 'vscode',
  displayName: 'VS Code (Copilot)',
  scopes: ['user', 'project'],
  transports: ['stdio', 'streamable-http', 'sse'],
  needsRestart: false,
  supportsSecureSecrets: true,
  configPath: (env, scope) => (scope.kind === 'project' ? join(requireProjectDir(scope), '.vscode', 'mcp.json') : join(userDir(env), 'mcp.json')),
  detect: async (env) => !!(await env.which('code')) || anyExists(env, [userDir(env)]),
  serversPath: () => ['servers'],
  render: (spec, opts) => {
    const { spec: swapped } = secretInputs(spec, opts);
    return { entry: commonEntry(swapped, (t) => (t === 'stdio' ? 'stdio' : t === 'sse' ? 'sse' : 'http')), warnings: [] };
  },
  afterUpsert: (text, spec, opts) => {
    let out = removeOurInputs(text, spec.name);
    for (const input of secretInputs(spec, opts).inputs) out = setAt(out, ['inputs', -1], input);
    return out;
  },
  afterRemove: removeOurInputs,
  ignoreInDiff: (root, name) => {
    if (!Array.isArray(root.inputs)) return;
    root.inputs = (root.inputs as Input[]).filter((i) => !(typeof i?.id === 'string' && i.id.startsWith(inputPrefix(name))));
    if ((root.inputs as Input[]).length === 0) delete root.inputs;
  },
});
