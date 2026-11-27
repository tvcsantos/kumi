// Packages from a private package registry: a company npm, PyPI, NuGet or container registry. Kumi writes the
// registry into the launch command, so the app downloads from the right place, and leaves signing in to each tool.

import type { RegistryPackage } from './registry';
import type { ServerSpec } from './types';

export type PackageRegistryType = 'npm' | 'pypi' | 'nuget' | 'oci';

/** A private registry a package is downloaded from. */
export interface PackageRegistry {
  type: PackageRegistryType;
  /** The registry URL as given to the tool, without credentials. For `oci`, `https://<host>`. */
  url: string;
  /** Host (and port, when not the default), for messages and Private networks patterns. */
  host: string;
  /** npm only: the scope routed to the registry, e.g. `@acme`. Unset: the whole run uses it. */
  scope?: string;
}

/** Public registries: no flag is written for them, so the user's own mirror settings keep applying. */
const PUBLIC_HOSTS: Record<PackageRegistryType, string[]> = {
  npm: ['registry.npmjs.org', 'registry.npmjs.com', 'registry.yarnpkg.com'],
  pypi: ['pypi.org', 'pypi.python.org', 'files.pythonhosted.org'],
  nuget: ['api.nuget.org', 'www.nuget.org', 'nuget.org'],
  oci: ['docker.io', 'index.docker.io', 'registry-1.docker.io', 'ghcr.io', 'quay.io', 'mcr.microsoft.com', 'public.ecr.aws', 'gcr.io', 'registry.gitlab.com'],
};

/** The tool each registry type is run with by default; registry flags are only known for these. */
const DEFAULT_COMMAND: Record<PackageRegistryType, string> = { npm: 'npx', pypi: 'uvx', nuget: 'dnx', oci: 'docker' };

const isType = (t: string): t is PackageRegistryType => t in PUBLIC_HOSTS;

export function isPublicRegistryHost(type: PackageRegistryType, host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return PUBLIC_HOSTS[type].includes(h);
}

/** npm's scope of a package name: `@acme/tickets` → `@acme`. */
export const npmScope = (name: string): string | undefined => /^(@[^/@\s]+)\/[^/\s]/.exec(name)?.[1];

/** The registry host of an image reference, when it names one: `registry.acme.com:5000/team/x:1` → `registry.acme.com:5000`. */
export function imageHost(ref: string): string | undefined {
  const first = ref.split('/')[0]!;
  if (!ref.includes('/')) return undefined;
  return /[.:]/.test(first) || first === 'localhost' ? first.toLowerCase() : undefined;
}

export interface RegistryOfPackage {
  registry?: PackageRegistry;
  /** Shown in the install wizard: something Kumi left out or couldn't do. */
  warning?: string;
  /** The package can't be installed as given. */
  error?: string;
}

/** The private registry a registry entry's package comes from, if any. */
export function registryOfPackage(pkg: RegistryPackage): RegistryOfPackage {
  const type = pkg.registryType;
  if (!isType(type)) return {};
  if (type === 'oci') {
    const fromId = imageHost(pkg.identifier);
    if (fromId) return isPublicRegistryHost('oci', fromId) ? {} : { registry: { type, url: `https://${fromId}`, host: fromId } };
  }
  if (!pkg.registryBaseUrl) return {};
  let url: URL;
  try {
    url = new URL(pkg.registryBaseUrl);
  } catch {
    return { error: `The registry URL "${pkg.registryBaseUrl}" isn't a valid URL.` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: `The registry URL "${pkg.registryBaseUrl}" must start with https:// or http://.` };
  const host = url.host.toLowerCase();
  if (isPublicRegistryHost(type, host)) return {};
  let warning: string | undefined;
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
    warning = `The registry URL for ${host} has credentials in it. Kumi left them out of your app's config: sign in to the registry instead.`;
  }
  const clean = url.toString();
  const registry: PackageRegistry = { type, url: clean, host };
  if (type === 'npm') {
    const scope = npmScope(pkg.identifier);
    if (scope) registry.scope = scope;
  }
  const command = pkg.runtimeHint ?? DEFAULT_COMMAND[type];
  if (command !== DEFAULT_COMMAND[type]) {
    warning = `${warning ? `${warning} ` : ''}This package runs with ${command}, so Kumi can't tell it to download from ${host}. Set that registry up in ${command}'s own configuration.`;
  }
  return { registry, ...(warning ? { warning } : {}) };
}

/** Whether Kumi knows how to pass the registry to this package's command. */
export function canPassRegistry(pkg: RegistryPackage): boolean {
  return isType(pkg.registryType) && (pkg.runtimeHint ?? DEFAULT_COMMAND[pkg.registryType]) === DEFAULT_COMMAND[pkg.registryType];
}

/** Flags that point the tool at the registry, placed before the package reference. */
export function registryArgs(registry: PackageRegistry): string[] {
  switch (registry.type) {
    case 'npm':
      return [registry.scope ? `--${registry.scope}:registry=${registry.url}` : `--registry=${registry.url}`];
    case 'pypi':
      return ['--index', registry.url];
    case 'nuget':
      return ['--add-source', registry.url];
    case 'oci':
      return [];
  }
}

/** The image reference with the registry host prefixed, for a bare identifier and a private `registryBaseUrl`. */
export function imageRef(ref: string, registry: PackageRegistry | undefined): string {
  if (!registry || registry.type !== 'oci' || imageHost(ref)) return ref;
  return `${registry.host}/${ref}`;
}

const valueAfter = (args: string[], i: number, flag: string): string | undefined => {
  const a = args[i]!;
  if (a === flag) return args[i + 1];
  return a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : undefined;
};

function fromUrl(type: PackageRegistryType, raw: string, scope?: string): PackageRegistry | undefined {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    const host = u.host.toLowerCase();
    if (isPublicRegistryHost(type, host)) return undefined;
    return { type, url: u.toString(), host, ...(scope ? { scope } : {}) };
  } catch {
    return undefined;
  }
}

/** The command's base name, without a path or a Windows extension: `C:\…\npx.cmd` → `npx`. */
const commandName = (command: string | undefined) => (command ?? '').split(/[\\/]/).pop()!.replace(/\.(cmd|exe|bat)$/i, '').toLowerCase();

/**
 * The private registry a configured server downloads from, read from its command line, so it works for servers
 * Kumi didn't install. Windows `cmd /c npx …` wrappers are looked through.
 */
export function registryOfSpec(spec: Pick<ServerSpec, 'transport' | 'command' | 'args'>): PackageRegistry | undefined {
  if (spec.transport !== 'stdio') return undefined;
  let command = commandName(spec.command);
  let args = spec.args ?? [];
  if (command === 'cmd' && /^\/c$/i.test(args[0] ?? '')) {
    command = commandName(args[1]);
    args = args.slice(2);
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (command === 'npx') {
      const scoped = /^--(@[^:=\s]+):registry=(.+)$/.exec(a);
      if (scoped) return fromUrl('npm', scoped[2]!, scoped[1]);
      const v = valueAfter(args, i, '--registry');
      if (v) return fromUrl('npm', v);
    } else if (command === 'uvx') {
      const v = valueAfter(args, i, '--index') ?? valueAfter(args, i, '--default-index') ?? valueAfter(args, i, '--index-url') ?? valueAfter(args, i, '--extra-index-url');
      // A named index (`acme=https://…`) is still that URL.
      if (v) return fromUrl('pypi', v.replace(/^[A-Za-z0-9_-]+=(?=https?:)/, ''));
    } else if (command === 'dnx') {
      const v = valueAfter(args, i, '--add-source') ?? valueAfter(args, i, '--source');
      if (v) return fromUrl('nuget', v);
    }
  }
  if (command === 'docker' && args[0] === 'run') {
    // The image is the first argument that isn't an option or an option's value.
    const withValue = new Set(['-e', '--env', '-v', '--volume', '-p', '--publish', '--name', '--network', '--mount', '-w', '--workdir', '-u', '--user', '--env-file', '--entrypoint', '--platform', '-l', '--label']);
    for (let i = 1; i < args.length; i++) {
      const a = args[i]!;
      if (a.startsWith('-')) {
        if (withValue.has(a)) i++;
        continue;
      }
      const host = imageHost(a);
      return host && !isPublicRegistryHost('oci', host) ? { type: 'oci', url: `https://${host}`, host } : undefined;
    }
  }
  return undefined;
}

/** A command that signs in to the registry, for the tools that have one. */
export function loginCommand(registry: PackageRegistry): string | undefined {
  switch (registry.type) {
    case 'npm':
      return `npm login --registry=${registry.url}${registry.scope ? ` --scope=${registry.scope}` : ''}`;
    case 'oci':
      return `docker login ${registry.host}`;
    case 'nuget':
      return `dotnet nuget add source ${registry.url} --username <user> --password <token>`;
    case 'pypi':
      return undefined;
  }
}

/** How to sign in, in words, with the command when there is one. */
export function loginAdvice(registry: PackageRegistry): string {
  const cmd = loginCommand(registry);
  if (registry.type === 'pypi') return `uv reads credentials for ${registry.host} from ~/.netrc: add a "machine ${registry.host.replace(/:\d+$/, '')}" entry with your login and token.`;
  return `Sign in once with: ${cmd}`;
}
