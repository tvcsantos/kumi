// Why a package couldn't be downloaded, read from the package manager's output (npm, uv, docker, dnx). These
// failures happen before the server runs, and the tools print them in a stable shape, so Kumi can say what went
// wrong instead of "Connection closed".

import { registryOfSpec, type PackageRegistry } from '@shared/package-registry';
import type { DownloadFailure, ServerSpec } from '@shared/types';
import { causeOf, type NetworkCause } from './network';

const hostOfUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
};

/** `@acme/tickets@^1.2` → `@acme/tickets`; `zod@3` → `zod`. */
const nameOf = (resource: string): string => {
  const at = resource.lastIndexOf('@');
  return at > 0 ? resource.slice(0, at) : resource;
};

/** The command's base name, through Windows `cmd /c` wrappers. */
function toolOf(spec: Pick<ServerSpec, 'command' | 'args'>): { tool: string; args: string[] } {
  const base = (c: string | undefined) => (c ?? '').split(/[\\/]/).pop()!.replace(/\.(cmd|exe|bat)$/i, '').toLowerCase();
  const args = spec.args ?? [];
  if (base(spec.command) === 'cmd' && /^\/c$/i.test(args[0] ?? '')) return { tool: base(args[1]), args: args.slice(2) };
  return { tool: base(spec.command), args };
}

/** Whether `name` is the package the command runs, rather than one of its dependencies. */
function isThePackage(name: string, args: string[], tool: string): boolean {
  const n = name.toLowerCase();
  return args.some((a) => {
    const x = a.toLowerCase();
    if (tool === 'uvx') return x === n || x.startsWith(`${n}@`) || x.startsWith(`${n}==`) || x.replace(/_/g, '-') === n.replace(/_/g, '-');
    return x === n || x.startsWith(`${n}@`);
  });
}

function fromText(text: string): NetworkCause | undefined {
  if (/no such host|server misbehaving|dns error|failed to lookup address|nodename nor servname|name or service not known|no such host is known|getaddrinfo/i.test(text)) return 'dns';
  if (/timed? ?out|i\/o timeout|request canceled while waiting/i.test(text)) return 'timeout';
  if (/no route to host|network is unreachable/i.test(text)) return 'route';
  if (/connection refused/i.test(text)) return 'refused';
  if (/connection reset/i.test(text)) return 'reset';
  return undefined;
}

function npm(stderr: string, args: string[]): Omit<DownloadFailure, 'registry'> | undefined {
  const code = /npm (?:error|ERR!) code (\S+)/.exec(stderr)?.[1];
  if (!code) return undefined;
  const host = hostOfUrl(/(?:GET|request to) (https?:\/\/\S+)/.exec(stderr)?.[1]);
  if (code === 'E401' || code === 'E403' || code === 'ENEEDAUTH') return { cause: 'sign-in', host };
  if (code === 'E404') {
    const resource = /requested resource '([^']+)'/.exec(stderr)?.[1] ?? /'([^']+)' is not in (?:this|the npm) registry/.exec(stderr)?.[1];
    const name = resource && nameOf(resource);
    return { cause: 'not-found', host, ...(name && !isThePackage(name, args, 'npx') ? { dependency: name } : {}) };
  }
  const network = causeOf(code);
  if (network === 'tls') return { cause: 'tls', host };
  if (network) return { cause: 'network', network, host };
  return undefined;
}

function uv(stderr: string, args: string[]): Omit<DownloadFailure, 'registry'> | undefined {
  const url = /(?:Failed to fetch|for url|index URL) `?\(?(https?:\/\/[^\s)`]+)/.exec(stderr)?.[1];
  const host = hostOfUrl(url);
  if (/\b(401 Unauthorized|403 Forbidden)\b|lack of valid authentication credentials/.test(stderr)) return { cause: 'sign-in', host };
  if (/invalid peer certificate|certificate verify failed|UnknownIssuer|invalid certificate/i.test(stderr)) return { cause: 'tls', host };
  if (/Failed to fetch|error sending request/.test(stderr)) {
    const network = fromText(stderr);
    if (network) return { cause: 'network', network, host };
  }
  const missing = /Because (\S+) was not found in the package registry/.exec(stderr)?.[1];
  if (missing) return { cause: 'not-found', host, ...(!isThePackage(missing, args, 'uvx') ? { dependency: missing } : {}) };
  return undefined;
}

function docker(stderr: string): Omit<DownloadFailure, 'registry'> | undefined {
  if (!/Error response from daemon|Unable to find image|pull access denied|Error: (?:pull|manifest)/i.test(stderr)) return undefined;
  const host = hostOfUrl(/(?:Get|Head) "(https?:\/\/[^"]+)"/.exec(stderr)?.[1]) ?? /lookup ([^\s:]+)/.exec(stderr)?.[1]?.toLowerCase();
  if (/x509:|tls: failed to verify certificate/i.test(stderr)) return { cause: 'tls', host };
  if (/unauthorized|authentication required|pull access denied|denied:|no basic auth credentials/i.test(stderr)) return { cause: 'sign-in', host };
  if (/manifest unknown|manifest for \S+ not found|not found: manifest/i.test(stderr)) return { cause: 'not-found', host };
  const network = fromText(stderr);
  if (network) return { cause: 'network', network, host };
  return undefined;
}

function nuget(stderr: string): Omit<DownloadFailure, 'registry'> | undefined {
  const host = hostOfUrl(/for source '?(https?:\/\/[^\s']+?)'?\.?\s/.exec(stderr)?.[1]);
  if (/\b401\b|\b403\b|Unauthorized|Forbidden/.test(stderr) && /NU1301|service index|source/i.test(stderr)) return { cause: 'sign-in', host };
  if (/The SSL connection could not be established|RemoteCertificate/i.test(stderr)) return { cause: 'tls', host };
  if (/NU1301|Unable to load the service index/i.test(stderr)) {
    const network = fromText(stderr);
    if (network) return { cause: 'network', network, host };
  }
  if (/NU1101|Unable to find package|could not be found/i.test(stderr)) return { cause: 'not-found', host };
  return undefined;
}

/**
 * Why the package couldn't be downloaded, or undefined when the output doesn't say (the server itself may have
 * failed). `registry` is the private registry from the command line, when there is one.
 */
export function downloadFailure(spec: ServerSpec, stderr: string): DownloadFailure | undefined {
  if (spec.transport !== 'stdio' || !stderr) return undefined;
  const { tool, args } = toolOf(spec);
  const found = tool === 'npx' ? npm(stderr, args) : tool === 'uvx' ? uv(stderr, args) : tool === 'docker' ? docker(stderr) : tool === 'dnx' ? nuget(stderr) : undefined;
  if (!found) return undefined;
  const registry = registryOfSpec(spec);
  const out: DownloadFailure = { ...found, ...(registry ? { registry } : {}) };
  if (!out.host && registry) out.host = registry.host;
  if (!out.host) delete out.host;
  // npm with `--registry` sends the whole run to the private registry: a dependency it lacks means it doesn't mirror npmjs.
  if (out.cause === 'not-found' && out.dependency && registry?.type === 'npm' && !registry.scope && (!found.host || found.host === registry.host)) out.cause = 'no-mirror';
  return out;
}

const NETWORK_WORDS: Partial<Record<NetworkCause, string>> = {
  dns: "the name doesn't resolve",
  timeout: "it didn't answer",
  route: "there's no network route to it",
  refused: 'it refused the connection',
  reset: 'it closed the connection',
};

const TLS_ADVICE: Record<PackageRegistry['type'], string> = {
  npm: 'If your company uses its own certificate authority, point NODE_EXTRA_CA_CERTS at it.',
  pypi: 'If your company uses its own certificate authority, point SSL_CERT_FILE at it, or set UV_NATIVE_TLS=1 to use the system store.',
  oci: "If your company uses its own certificate authority, add it to Docker's trusted certificates.",
  nuget: 'If your company uses its own certificate authority, add it to the system certificate store.',
};

const TYPE_OF_TOOL: Record<string, PackageRegistry['type']> = { npx: 'npm', uvx: 'pypi', docker: 'oci', dnx: 'nuget' };

/**
 * The failure in words, for the test result and the log. Sign-in commands are shown by the UI, from `registry`.
 * `original` is the test's own error, kept when the cause is inferred.
 */
export function describeDownload(f: DownloadFailure, spec: ServerSpec, original?: string): string {
  const where = f.host ?? 'the package registry';
  const isPrivate = !!f.registry && (!f.host || f.host === f.registry.host);
  switch (f.cause) {
    case 'network': {
      const words = NETWORK_WORDS[f.network!] ?? 'the connection failed';
      if (f.inferred) return `${original ?? 'Timed out'}. The package is downloaded from ${where}, which isn't reachable from here: ${words}`;
      return `Couldn't download the package from ${where}: ${words}`;
    }
    case 'sign-in':
      return isPrivate
        ? `${where} wants you to sign in before it lets you download the package`
        : `${where} refused the download: your saved credentials for it are missing or out of date`;
    case 'not-found':
      if (f.dependency) return `${where} has no ${f.dependency}, which the package needs`;
      return isPrivate
        ? `${where} has no such package, or won't show it until you sign in (most private registries answer "not found" when you aren't signed in)`
        : `${where} has no such package or version. Check the package name and version`;
    case 'no-mirror':
      return `${where} has the package but not its dependency ${f.dependency}: the registry doesn't mirror npmjs.org, so the dependencies can't be downloaded. Ask its admins to proxy npmjs.org, or publish the package under a scope`;
    case 'tls': {
      const type = f.registry?.type ?? TYPE_OF_TOOL[toolOf(spec).tool];
      return `Couldn't verify the certificate of ${where}. ${type ? TLS_ADVICE[type] : ''}`.trim();
    }
  }
}
