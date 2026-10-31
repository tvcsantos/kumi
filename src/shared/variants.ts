// Turns registry `server.json` metadata into install variants, form fields, and a resolved ServerSpec.
// Pure functions, so the renderer can show a live preview and the main process can validate.

import type {
  InputField,
  InstallVariant,
  RegistryArgument,
  RegistryInput,
  RegistryPackage,
  RegistryRemote,
  RegistryServer,
} from './registry';
import type { ServerSpec, Transport } from './types';

export type FormValues = Record<string, string>;

const PLACEHOLDER = /\{([A-Za-z0-9_.-]+)\}/g;
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function placeholders(value: string): string[] {
  return [...new Set([...value.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

function normalizeFormat(format: string | undefined): InputField['format'] {
  return format === 'number' || format === 'boolean' || format === 'filepath' ? format : 'string';
}

/** Fields needed to resolve one input: one field, or one per `{placeholder}` in a fixed value. */
function fieldsFor(input: RegistryInput, id: string, label: string, group: InputField['group']): InputField[] {
  if (input.value === undefined) {
    return [
      {
        id,
        label,
        description: input.description,
        required: !!input.isRequired,
        secret: !!input.isSecret,
        format: normalizeFormat(input.format),
        default: input.default,
        placeholder: input.placeholder,
        choices: input.choices,
        group,
      },
    ];
  }
  return placeholders(input.value).map((name) => {
    const def = input.variables?.[name];
    return {
      id: `${id}.${name}`,
      label: def ? name : `${label}: ${name}`,
      description: def?.description ?? input.description,
      // An undeclared placeholder in a required value must be filled in.
      required: def ? !!def.isRequired : !!input.isRequired,
      secret: !!(def?.isSecret ?? input.isSecret),
      format: normalizeFormat(def?.format),
      default: def?.default,
      placeholder: def?.placeholder,
      choices: def?.choices,
      group,
    };
  });
}

function valueOf(values: FormValues, field: { id: string; default?: string }): string | undefined {
  const v = values[field.id] !== undefined ? values[field.id] : field.default;
  return v === undefined || v === '' ? undefined : v;
}

/** Resolves an input to its final string, or undefined when it should be omitted. */
function resolveInput(input: RegistryInput, id: string, values: FormValues): string | undefined {
  if (input.value === undefined) return valueOf(values, { id, default: input.default });
  let missing = false;
  const out = input.value.replace(PLACEHOLDER, (_, name: string) => {
    const v = valueOf(values, { id: `${id}.${name}`, default: input.variables?.[name]?.default });
    if (v === undefined) missing = true;
    return v ?? '';
  });
  return missing ? undefined : out;
}

function isSecretInput(input: RegistryInput): boolean {
  if (input.isSecret) return true;
  return Object.values(input.variables ?? {}).some((v) => v.isSecret);
}

function argLabel(arg: RegistryArgument, i: number): string {
  return arg.name ?? arg.valueHint ?? `argument ${i + 1}`;
}

function argFields(args: RegistryArgument[] | undefined, prefix: string): InputField[] {
  return (args ?? []).flatMap((a, i) => fieldsFor(a, `${prefix}.${i}`, argLabel(a, i), 'argument'));
}

interface ResolvedArgs {
  args: string[];
  secretIndexes: number[];
  missing: string[];
}

function resolveArgs(args: RegistryArgument[] | undefined, prefix: string, values: FormValues, offset: number): ResolvedArgs {
  const out: ResolvedArgs = { args: [], secretIndexes: [], missing: [] };
  (args ?? []).forEach((a, i) => {
    const v = resolveInput(a, `${prefix}.${i}`, values);
    if (v === undefined) {
      if (a.isRequired) out.missing.push(argLabel(a, i));
      return;
    }
    const repeated = a.isRepeated ? v.split('\n').filter(Boolean) : [v];
    for (const item of repeated) {
      if (a.type === 'named' && a.name) out.args.push(a.name);
      if (isSecretInput(a)) out.secretIndexes.push(offset + out.args.length);
      out.args.push(item);
    }
  });
  return out;
}

interface PackageRuntime {
  command: string;
  ref: string;
  defaultRuntimeArgs: string[];
  trailingArgs: string[];
}

function packageRuntime(pkg: RegistryPackage): PackageRuntime | null {
  const { identifier: id, version } = pkg;
  switch (pkg.registryType) {
    case 'npm': {
      const command = pkg.runtimeHint ?? 'npx';
      return { command, ref: version ? `${id}@${version}` : id, defaultRuntimeArgs: command === 'npx' ? ['-y'] : [], trailingArgs: [] };
    }
    case 'pypi':
      return { command: pkg.runtimeHint ?? 'uvx', ref: version ? `${id}@${version}` : id, defaultRuntimeArgs: [], trailingArgs: [] };
    case 'oci': {
      const hasTag = /:[^/]+$/.test(id) || id.includes('@sha256:');
      return { command: pkg.runtimeHint ?? 'docker', ref: version && !hasTag ? `${id}:${version}` : id, defaultRuntimeArgs: [], trailingArgs: [] };
    }
    case 'nuget':
      return { command: pkg.runtimeHint ?? 'dnx', ref: version ? `${id}@${version}` : id, defaultRuntimeArgs: [], trailingArgs: ['--yes'] };
    default:
      return null;
  }
}

function packageVariant(pkg: RegistryPackage, index: number): InstallVariant {
  const transport = (pkg.transport?.type ?? 'stdio') as Transport;
  const runtime = packageRuntime(pkg);
  const label = `${pkg.registryType} · ${pkg.identifier}${pkg.version && pkg.registryType !== 'oci' ? `@${pkg.version}` : ''}`;
  const base = { ref: { kind: 'package', index } as const, label, transport, runtime: runtime?.command };
  if (!runtime) {
    return { ...base, transport: 'stdio', fields: [], unsupported: `"${pkg.registryType}" packages are not supported yet.` };
  }
  if (transport !== 'stdio') {
    return {
      ...base,
      fields: [],
      unsupported: 'This package runs as a local HTTP server, which Kumi cannot launch yet. Use a hosted variant or start it yourself.',
    };
  }
  const fields = [
    ...(pkg.environmentVariables ?? []).flatMap((e) => fieldsFor(e, `env.${e.name}`, e.name, 'env')),
    ...argFields(pkg.runtimeArguments, 'rt'),
    ...argFields(pkg.packageArguments, 'pkg'),
  ];
  return { ...base, fields };
}

function remoteVariant(remote: RegistryRemote, index: number): InstallVariant {
  let host = remote.url;
  try {
    host = new URL(remote.url.replace(PLACEHOLDER, 'x')).host;
  } catch {
    // keep raw url as label
  }
  const transport: Transport = remote.type === 'sse' ? 'sse' : 'streamable-http';
  const urlFields = placeholders(remote.url).map((name) => {
    const def = remote.variables?.[name] ?? { isRequired: true };
    return fieldsFor(def, `url.${name}`, name, 'url')[0];
  });
  const headerFields = (remote.headers ?? []).flatMap((h) => fieldsFor(h, `header.${h.name}`, h.name, 'header'));
  const unsupported = remote.type !== 'sse' && remote.type !== 'streamable-http' ? `Unknown remote type "${remote.type}".` : undefined;
  return {
    ref: { kind: 'remote', index },
    label: `Hosted · ${host}${transport === 'sse' ? ' (SSE)' : ''}`,
    transport,
    fields: [...urlFields, ...headerFields],
    unsupported,
  };
}

/** All install variants of a server; packages first, then remotes. */
export function getVariants(server: RegistryServer): InstallVariant[] {
  return [...(server.packages ?? []).map(packageVariant), ...(server.remotes ?? []).map(remoteVariant)];
}

/** Picks the variant to preselect: first supported package, else first supported remote. */
export function defaultVariant(variants: InstallVariant[]): InstallVariant | undefined {
  return variants.find((v) => !v.unsupported);
}

export function initialValues(variant: InstallVariant): FormValues {
  const values: FormValues = {};
  for (const f of variant.fields) values[f.id] = f.default ?? (f.format === 'boolean' ? 'false' : '');
  return values;
}

export function validateValues(variant: InstallVariant, values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of variant.fields) {
    const v = values[f.id] ?? '';
    if (f.required && v.trim() === '') errors[f.id] = 'Required';
    else if (v !== '' && f.format === 'number' && Number.isNaN(Number(v))) errors[f.id] = 'Must be a number';
    else if (v !== '' && f.choices?.length && !f.choices.includes(v)) errors[f.id] = `Must be one of: ${f.choices.join(', ')}`;
  }
  return errors;
}

export type ResolveResult = { ok: true; spec: ServerSpec } | { ok: false; error: string };

export function resolveVariant(server: RegistryServer, ref: InstallVariant['ref'], name: string, values: FormValues): ResolveResult {
  if (!SERVER_NAME_PATTERN.test(name)) {
    return { ok: false, error: 'Server name may only contain letters, digits, "-" and "_".' };
  }
  if (ref.kind === 'package') {
    const pkg = server.packages?.[ref.index];
    if (!pkg) return { ok: false, error: 'Unknown package.' };
    return resolvePackage(pkg, ref.index, name, values);
  }
  const remote = server.remotes?.[ref.index];
  if (!remote) return { ok: false, error: 'Unknown remote.' };
  return resolveRemote(remote, ref.index, name, values);
}

function resolvePackage(pkg: RegistryPackage, index: number, name: string, values: FormValues): ResolveResult {
  const variant = packageVariant(pkg, index);
  const runtime = packageRuntime(pkg);
  if (variant.unsupported || !runtime) return { ok: false, error: variant.unsupported ?? 'Unsupported package.' };

  const env: Record<string, string> = {};
  const secretEnv: string[] = [];
  const missing: string[] = [];
  for (const e of pkg.environmentVariables ?? []) {
    const v = resolveInput(e, `env.${e.name}`, values);
    if (v === undefined) {
      if (e.isRequired) missing.push(e.name);
      continue;
    }
    env[e.name] = v;
    if (isSecretInput(e)) secretEnv.push(e.name);
  }

  const args: string[] = [];
  const secretArgs: number[] = [];
  const isDocker = pkg.registryType === 'oci';
  const runtimeArgs = resolveArgs(pkg.runtimeArguments, 'rt', values, 0);
  if (isDocker && runtimeArgs.args[0] !== 'run') {
    args.push('run', '-i', '--rm');
    for (const key of Object.keys(env)) args.push('-e', key);
  }
  const rt = pkg.runtimeArguments?.length ? runtimeArgs : { args: runtime.defaultRuntimeArgs, secretIndexes: [], missing: [] };
  secretArgs.push(...rt.secretIndexes.map((i) => i + args.length));
  args.push(...rt.args, runtime.ref);
  const pk = resolveArgs(pkg.packageArguments, 'pkg', values, args.length);
  secretArgs.push(...pk.secretIndexes);
  args.push(...pk.args, ...runtime.trailingArgs);
  missing.push(...runtimeArgs.missing, ...pk.missing);

  if (missing.length) return { ok: false, error: `Missing required: ${missing.join(', ')}` };
  return {
    ok: true,
    spec: {
      name,
      transport: 'stdio',
      command: runtime.command,
      args,
      ...(Object.keys(env).length ? { env } : {}),
      ...(secretEnv.length ? { secretEnv } : {}),
      ...(secretArgs.length ? { secretArgs } : {}),
    },
  };
}

function resolveRemote(remote: RegistryRemote, index: number, name: string, values: FormValues): ResolveResult {
  const variant = remoteVariant(remote, index);
  if (variant.unsupported) return { ok: false, error: variant.unsupported };
  const missing: string[] = [];
  const url = remote.url.replace(PLACEHOLDER, (_, v: string) => {
    const resolved = valueOf(values, { id: `url.${v}`, default: remote.variables?.[v]?.default });
    if (resolved === undefined) missing.push(v);
    return resolved ?? '';
  });
  const headers: Record<string, string> = {};
  const secretHeaders: string[] = [];
  for (const h of remote.headers ?? []) {
    const v = resolveInput(h, `header.${h.name}`, values);
    if (v === undefined) {
      if (h.isRequired) missing.push(h.name);
      continue;
    }
    headers[h.name] = v;
    if (isSecretInput(h)) secretHeaders.push(h.name);
  }
  if (missing.length) return { ok: false, error: `Missing required: ${missing.join(', ')}` };
  return {
    ok: true,
    spec: {
      name,
      transport: variant.transport,
      url,
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(secretHeaders.length ? { secretHeaders } : {}),
    },
  };
}

const GENERIC_NAMES = new Set(['mcp', 'server', 'mcp-server', 'remote', 'api']);

/** Suggests a short config key, e.g. "io.github.github/github-mcp-server" → "github". */
export function suggestName(server: Pick<RegistryServer, 'name' | 'title'>): string {
  const [namespace, last = ''] = server.name.split('/');
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/(^|-)mcp(-server)?($|-)/g, '$1')
      .replace(/(^|-)server($|-)/g, '$1')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  let name = clean(last);
  if (!name || GENERIC_NAMES.has(name)) {
    const labels = namespace.split('.').filter((l) => !['com', 'io', 'ai', 'app', 'dev', 'org', 'net', 'github', 'mcp'].includes(l));
    name = clean(labels[0] ?? '') || clean(server.title ?? '') || 'server';
  }
  return name;
}

/** Copy of a spec with secret values replaced, for previews and logs. */
export function maskSpec(spec: ServerSpec, mask = '••••••••'): ServerSpec {
  const out: ServerSpec = { ...spec };
  if (spec.env && spec.secretEnv?.length) {
    out.env = { ...spec.env };
    for (const k of spec.secretEnv) if (k in out.env) out.env[k] = mask;
  }
  if (spec.headers && spec.secretHeaders?.length) {
    out.headers = { ...spec.headers };
    for (const k of spec.secretHeaders) if (k in out.headers) out.headers[k] = mask;
  }
  if (spec.args && spec.secretArgs?.length) {
    out.args = spec.args.map((a, i) => (spec.secretArgs!.includes(i) ? mask : a));
  }
  return out;
}

/** Secret values in a spec, so they can be scrubbed from any text. */
export function secretValues(spec: ServerSpec): string[] {
  const out: string[] = [];
  for (const k of spec.secretEnv ?? []) if (spec.env?.[k]) out.push(spec.env[k]);
  for (const k of spec.secretHeaders ?? []) if (spec.headers?.[k]) out.push(spec.headers[k]);
  for (const i of spec.secretArgs ?? []) if (spec.args?.[i]) out.push(spec.args[i]);
  return out.filter((v) => v.length >= 4);
}
