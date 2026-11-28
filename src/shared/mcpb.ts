// MCP Bundles (`.mcpb`): a zip with the server's code and a `manifest.json` that says how to run it and which
// settings it takes. The registry's `server.json` only says where to download the bundle and its hash, so once Kumi has
// unpacked it, the manifest alone builds the form and the command.
// Spec: https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
// Pure functions, so the renderer can show a live preview and the main process can validate.

import type { InputField, InstallVariant } from './registry';
import type { ServerSpec } from './types';

export type McpbServerType = 'node' | 'python' | 'binary' | 'uv';

export interface McpbUserConfig {
  type: 'string' | 'number' | 'boolean' | 'directory' | 'file';
  title?: string;
  description?: string;
  required?: boolean;
  /** May use `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}` and `${DOWNLOADS}`; an array for `multiple` settings. */
  default?: string | number | boolean | string[];
  /** `directory` and `file` settings: several values, each passed as its own argument. */
  multiple?: boolean;
  /** `string` settings: a secret. */
  sensitive?: boolean;
  min?: number;
  max?: number;
}

export interface McpbCommand {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpbMcpConfig extends McpbCommand {
  /** Keyed by `process.platform`: `darwin`, `win32`, `linux`. */
  platform_overrides?: Record<string, McpbCommand>;
}

export interface McpbManifest {
  manifest_version: string;
  name: string;
  display_name?: string;
  version: string;
  description?: string;
  server: {
    type: McpbServerType;
    entry_point?: string;
    /** Optional for `uv`, where the host runs `entry_point` itself. */
    mcp_config?: McpbMcpConfig;
  };
  user_config?: Record<string, McpbUserConfig>;
  compatibility?: {
    platforms?: string[];
    runtimes?: Record<string, string>;
  };
}

/** Machine facts the manifest's variables need. */
export interface BundleHost {
  platform: string;
  home: string;
  desktop: string;
  documents: string;
  downloads: string;
  pathSeparator: string;
  /** Separates paths in a list, e.g. in PATH: `:` or `;`. */
  pathDelimiter: string;
}

/** A downloaded, checked and unpacked bundle. */
export interface PreparedBundle {
  sha256: string;
  /** Where it was unpacked: `${__dirname}`. */
  dir: string;
  manifest: McpbManifest;
  host: BundleHost;
}

const FIELD_PREFIX = 'cfg.';
const VARIABLE = /\$\{([^}]+)\}/g;
const USER_CONFIG = 'user_config.';

const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** Runtimes Kumi checks for (see `runtime/detect.ts`), by the command a manifest runs. */
const KNOWN_RUNTIMES = new Set(['node', 'python3', 'python', 'uv']);

/** Which `compatibility.runtimes` entry applies to a command. `uv` picks its own Python, so it has none. */
const RANGE_KEY: Record<string, string> = { node: 'node', python3: 'python', python: 'python' };

/** Variables a manifest can use anywhere, user settings aside. */
function builtIns(bundle: Pick<PreparedBundle, 'dir' | 'host'>): Record<string, string> {
  const { host } = bundle;
  return {
    __dirname: bundle.dir,
    HOME: host.home,
    DESKTOP: host.desktop,
    DOCUMENTS: host.documents,
    DOWNLOADS: host.downloads,
    pathSeparator: host.pathSeparator,
    '/': host.pathSeparator,
  };
}

/** Replaces the built-in variables; others are left as they are. */
function expandBuiltIns(text: string, vars: Record<string, string>): string {
  return text.replace(VARIABLE, (whole, name: string) => vars[name] ?? whole);
}

function defaultValue(config: McpbUserConfig, vars: Record<string, string>): string | undefined {
  const d = config.default;
  if (d === undefined) return undefined;
  if (Array.isArray(d)) return d.map((v) => expandBuiltIns(String(v), vars)).join('\n');
  return expandBuiltIns(String(d), vars);
}

function fieldFormat(type: McpbUserConfig['type']): InputField['format'] {
  if (type === 'file') return 'filepath';
  if (type === 'number' || type === 'boolean' || type === 'directory') return type;
  return 'string';
}

/** The form fields for a bundle's `user_config`. */
export function bundleFields(bundle: Pick<PreparedBundle, 'dir' | 'host' | 'manifest'>): InputField[] {
  const vars = builtIns(bundle);
  return Object.entries(bundle.manifest.user_config ?? {}).map(([key, c]) => ({
    id: FIELD_PREFIX + key,
    label: c.title ?? key,
    description: c.description,
    required: !!c.required,
    secret: !!c.sensitive,
    format: fieldFormat(c.type),
    default: defaultValue(c, vars),
    ...(c.multiple ? { multiple: true } : {}),
    ...(c.min !== undefined ? { min: c.min } : {}),
    ...(c.max !== undefined ? { max: c.max } : {}),
    group: 'config' as const,
  }));
}

/**
 * The command for this platform. An override replaces `command` and `args` when it sets them, and adds to `env`:
 * the spec's examples override either the command or the env alone, and doesn't say more.
 * A `uv` bundle without `mcp_config` is run with `uv run`; a `binary` one without a command runs its entry point.
 */
export function bundleCommand(manifest: McpbManifest, platform: string): McpbCommand {
  const { server } = manifest;
  const base = server.mcp_config ?? {};
  const over = base.platform_overrides?.[platform] ?? {};
  let command = over.command ?? base.command;
  let args = over.args ?? base.args;
  const env = base.env || over.env ? { ...base.env, ...over.env } : undefined;
  if (!command && server.entry_point) {
    if (server.type === 'uv') {
      command = 'uv';
      args = args ?? ['run', '--directory', '${__dirname}', '${__dirname}/' + server.entry_point];
    } else if (server.type === 'binary') {
      command = '${__dirname}/' + server.entry_point;
      args = args ?? [];
    }
  }
  // Apps add `.exe` to a bundled binary on Windows.
  if (command && server.type === 'binary' && platform === 'win32' && command.startsWith('${__dirname}') && !/\.[a-z0-9]+$/i.test(command)) {
    command += '.exe';
  }
  return { command, args, env };
}

/** Why this bundle can't be installed here, if it can't. */
export function bundleProblem(bundle: Pick<PreparedBundle, 'manifest' | 'host'>): string | undefined {
  const { manifest, host } = bundle;
  const platforms = manifest.compatibility?.platforms;
  if (platforms?.length && !platforms.includes(host.platform)) {
    const names = platforms.map((p) => PLATFORM_NAMES[p] ?? p).join(', ');
    return `This bundle only runs on ${names}.`;
  }
  if (!bundleCommand(manifest, host.platform).command) return "The bundle's manifest doesn't say how to start the server.";
  return undefined;
}

/** The runtime Kumi can check for, from the command the bundle runs. */
function runtimeOf(command: string | undefined): string | undefined {
  return command && KNOWN_RUNTIMES.has(command) ? command : undefined;
}

/** `variant` (an `mcpb` package) once its bundle is downloaded: the manifest's settings and runtime. */
export function bundleVariant(variant: InstallVariant, bundle: PreparedBundle): InstallVariant {
  const problem = bundleProblem(bundle);
  const runtime = runtimeOf(bundleCommand(bundle.manifest, bundle.host.platform).command);
  if (problem) return { ...variant, fields: [], unsupported: problem };
  const runtimeRange = runtime ? bundle.manifest.compatibility?.runtimes?.[RANGE_KEY[runtime]] : undefined;
  return { ...variant, fields: bundleFields(bundle), ...(runtime ? { runtime } : {}), ...(runtimeRange ? { runtimeRange } : {}) };
}

interface Expanded {
  /** Undefined when a setting it uses has no value: the argument or env var is left out. */
  values?: string[];
  secret: boolean;
}

type ConfigValues = Record<string, { values: string[]; secret: boolean }>;

/**
 * Substitutes one manifest string. A string that is only a `multiple` setting becomes one argument per value
 * (`spread`); elsewhere a list is joined with the platform's path delimiter, since these are lists of paths.
 */
function expand(text: string, vars: Record<string, string>, config: ConfigValues, host: BundleHost, spread: boolean): Expanded {
  const whole = /^\$\{user_config\.([^}]+)\}$/.exec(text);
  if (whole && spread) {
    const c = config[whole[1]];
    if (!c) return { values: [text], secret: false };
    return { values: c.values.length ? c.values : undefined, secret: c.secret };
  }
  let secret = false;
  let missing = false;
  const out = text.replace(VARIABLE, (match, name: string) => {
    if (name.startsWith(USER_CONFIG)) {
      const c = config[name.slice(USER_CONFIG.length)];
      if (!c) return match;
      if (!c.values.length) missing = true;
      if (c.secret) secret = true;
      return c.values.join(host.pathDelimiter);
    }
    return vars[name] ?? match;
  });
  return { values: missing ? undefined : [out], secret };
}

export type BundleResolveResult = { ok: true; spec: ServerSpec } | { ok: false; error: string };

/** The `ServerSpec` that runs `bundle` with the form's `values`. */
export function resolveBundle(bundle: PreparedBundle, name: string, values: Record<string, string>): BundleResolveResult {
  const problem = bundleProblem(bundle);
  if (problem) return { ok: false, error: problem };
  const { manifest, host } = bundle;
  const vars = builtIns(bundle);

  const config: ConfigValues = {};
  const missing: string[] = [];
  for (const field of bundleFields(bundle)) {
    const key = field.id.slice(FIELD_PREFIX.length);
    const raw = values[field.id] !== undefined ? values[field.id] : (field.default ?? '');
    const list = field.multiple ? raw.split('\n').map((v) => v.trim()).filter(Boolean) : raw === '' ? [] : [raw];
    if (field.required && !list.length) missing.push(field.label);
    config[key] = { values: list, secret: field.secret };
  }
  if (missing.length) return { ok: false, error: `Missing required: ${missing.join(', ')}` };

  const cmd = bundleCommand(manifest, host.platform);
  const command = expand(cmd.command!, vars, config, host, false);
  if (!command.values) return { ok: false, error: 'The command needs a setting that has no value.' };

  const args: string[] = [];
  const secretArgs: number[] = [];
  for (const arg of cmd.args ?? []) {
    const e = expand(arg, vars, config, host, true);
    for (const v of e.values ?? []) {
      if (e.secret) secretArgs.push(args.length);
      args.push(v);
    }
  }

  const env: Record<string, string> = {};
  const secretEnv: string[] = [];
  for (const [key, value] of Object.entries(cmd.env ?? {})) {
    const e = expand(value, vars, config, host, false);
    if (!e.values) continue;
    env[key] = e.values[0];
    if (e.secret) secretEnv.push(key);
  }

  return {
    ok: true,
    spec: {
      name,
      transport: 'stdio',
      command: command.values[0],
      args,
      ...(Object.keys(env).length ? { env } : {}),
      ...(secretEnv.length ? { secretEnv } : {}),
      ...(secretArgs.length ? { secretArgs } : {}),
    },
  };
}

/** SHA-256s of the bundles a config file (or spec) points at: Kumi unpacks each into `bundles/<sha256>`. */
export function bundleShasIn(text: string): string[] {
  return [...new Set([...text.matchAll(/bundles[\\/]+([a-f0-9]{64})(?![a-f0-9])/g)].map((m) => m[1]))];
}
