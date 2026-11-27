// "Test connection": start the server (or connect to it), do the MCP handshake and list its tools.
// A server that asks for OAuth is only checked to be up, unless the user asked to sign in: each app signs in
// on its own anyway, and some servers don't let Kumi register at all.

import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { hostOf, matchHost, type PrivateNetwork, type PrivateNetworkSettings } from '@shared/private-network';
import type { DownloadFailure, HealthResult, HealthTestOptions, ServerSpec } from '@shared/types';
import { registryOfSpec } from '@shared/package-registry';
import { log } from '../log';
import { describeDownload, downloadFailure } from './download';
import { causeOf, codedError, describeCause, errorCode, isUnreachable, probe, resolveAddress, type NetworkCause } from './network';
import { OAuthSession, type OpenBrowser } from './oauth';

export interface TestOptions extends HealthTestOptions {
  openBrowser?: OpenBrowser;
  /** The Private networks settings, to tell whether a remote server's host is on a private network. */
  networks?: PrivateNetworkSettings;
}

const TIMEOUT_MS = 90_000; // first `npx`/`uvx`/`docker` run may download the package
/** A remote server has nothing to download, so a slow answer usually means nothing is answering. */
const REMOTE_TIMEOUT_MS = 15_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** The result (and so the UI) gets the end of the server's stderr; the log keeps much more of it. */
const STDERR_SHOWN = 4000;
const STDERR_LOGGED = 64 * 1024;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function hint(message: string, stderr: string): string {
  if (/ENOENT|not found|spawn .* ENOENT/i.test(message)) return `${message}. Is the command installed and on your PATH?`;
  if (/\b401\b|unauthori[sz]ed/i.test(message + stderr)) return `${message}. Check your API key or token.`;
  if (/\b403\b|forbidden/i.test(message + stderr)) return `${message}. The credentials don't have access.`;
  return message;
}

interface ConnectOptions {
  onStderr: (chunk: string) => void;
  authProvider?: OAuthClientProvider;
  /** Receives each remote transport as it's created, so a sign-in can be finished on it. */
  onRemote?: (t: StreamableHTTPClientTransport | SSEClientTransport) => void;
}

async function connect(spec: ServerSpec, client: Client, { onStderr, authProvider, onRemote }: ConnectOptions): Promise<Transport> {
  if (spec.transport === 'stdio') {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    const transport = new StdioClientTransport({ command: spec.command!, args: spec.args ?? [], env: { ...env, ...spec.env }, stderr: 'pipe' });
    transport.stderr?.on('data', (d: Buffer) => onStderr(d.toString()));
    await client.connect(transport);
    return transport;
  }
  const url = new URL(spec.url!);
  const requestInit = { headers: spec.headers ?? {} };
  if (spec.transport === 'streamable-http') {
    try {
      const transport = new StreamableHTTPClientTransport(url, { requestInit, authProvider });
      onRemote?.(transport);
      await client.connect(transport);
      return transport;
    } catch (e) {
      // Some servers still only speak the older SSE transport.
      if (!/\b(404|405)\b/.test(String(e))) throw e;
    }
  }
  const transport = new SSEClientTransport(url, { requestInit, authProvider });
  onRemote?.(transport);
  await client.connect(transport);
  return transport;
}

const openInBrowser: OpenBrowser = async (url) => {
  const { shell } = await import('electron');
  await shell.openExternal(url);
};

/** Remote servers without a configured `Authorization` header may use MCP OAuth. */
function mayUseOAuth(spec: ServerSpec): boolean {
  return spec.transport !== 'stdio' && !Object.keys(spec.headers ?? {}).some((h) => h.toLowerCase() === 'authorization');
}

const SECRET_NAME = /token|key|secret|passw(or)?d|auth|credential|bearer/i;

/** What was started or contacted, without secrets: env and header values, flagged args, URL query and credentials. */
export function describeForLog(spec: ServerSpec): string {
  const lines = [`transport: ${spec.transport}`];
  if (spec.transport === 'stdio') {
    const secret = new Set(spec.secretArgs ?? []);
    const args = (spec.args ?? []).map((a, i, all) => {
      if (secret.has(i) || (i > 0 && /^--?[\w-]+$/.test(all[i - 1]!) && SECRET_NAME.test(all[i - 1]!))) return '***';
      const eq = a.indexOf('=');
      return eq > 0 && SECRET_NAME.test(a.slice(0, eq)) ? `${a.slice(0, eq)}=***` : a;
    });
    lines.push(`command: ${[spec.command, ...args].join(' ')}`);
    const env = Object.keys(spec.env ?? {});
    if (env.length) lines.push(`env (values hidden): ${env.join(', ')}`);
  } else {
    let url = spec.url ?? '';
    try {
      const u = new URL(url);
      url = `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
    } catch {}
    lines.push(`url: ${url}`);
    const headers = Object.keys(spec.headers ?? {});
    if (headers.length) lines.push(`headers (values hidden): ${headers.join(', ')}`);
  }
  return lines.join('\n');
}

/** Why Kumi can't sign in to a server that uses OAuth, from what discovery found. */
function signInUnavailableReason(oauth: OAuthSession): string {
  if (oauth.hasClient) return "Kumi couldn't sign in to it.";
  if (oauth.authServerMetadata?.registration_endpoint) return "It doesn't let other apps register with it.";
  return 'It only accepts apps registered with it in advance.';
}

/**
 * Why a remote server failed when no HTTP answer came back: its name doesn't resolve, nothing answered, no route,
 * a refused or dropped connection. Also the address the name resolves to, for matching address ranges.
 */
async function diagnose(spec: ServerSpec, e: unknown): Promise<{ cause?: NetworkCause; address?: string }> {
  const url = new URL(spec.url!);
  const cause = causeOf(errorCode(e));
  // Without a system error (the SSE transport drops it, or Kumi's own timeout fired), look the host up and connect to it.
  if (!cause) return probe(url).catch(() => ({}));
  if (cause === 'timeout') return { cause, address: await resolveAddress(url.hostname) };
  return { cause };
}

/**
 * The registry's flag, or the host matched against the Private networks settings: the remote server's host, or for
 * a package, the host it couldn't be downloaded from.
 */
function privateNetworkOf(spec: ServerSpec, opts: TestOptions, address?: string, downloadHost?: string): PrivateNetwork | undefined {
  if (opts.privateNetwork) return { source: 'registry', ...(opts.privateNetwork.vpn ? { vpn: opts.privateNetwork.vpn } : {}) };
  const host = spec.transport === 'stdio' ? downloadHost?.replace(/:\d+$/, '') : hostOf(spec.url);
  return host && opts.networks ? matchHost(host, opts.networks, address) : undefined;
}

/**
 * A package that timed out may still be waiting on its registry (npm retries for a while). When the command names a
 * private registry, check it answers: if not, that's the likely cause.
 */
async function probeRegistry(spec: ServerSpec): Promise<{ download?: DownloadFailure; address?: string }> {
  const registry = registryOfSpec(spec);
  if (!registry) return {};
  const found = await probe(new URL(registry.url)).catch(() => ({}) as { cause?: undefined; address?: undefined });
  if (!found.cause) return {};
  return { download: { cause: 'network', network: found.cause, host: registry.host, registry, inferred: true }, address: found.address };
}

export async function testServer(spec: ServerSpec, opts: TestOptions = {}): Promise<HealthResult> {
  const { signIn = false, openBrowser = openInBrowser } = opts;
  const timeoutMs = spec.transport === 'stdio' ? TIMEOUT_MS : REMOTE_TIMEOUT_MS;
  const started = Date.now();
  let fullStderr = '';
  const onStderr = (c: string) => (fullStderr = (fullStderr + c).slice(-STDERR_LOGGED));
  let client = new Client({ name: 'kumi', version: '0.1.0' });
  let transport: Transport | undefined;
  let oauth: OAuthSession | undefined;
  const reachable = (available: boolean, reason?: string): HealthResult => ({
    ok: true,
    tools: [],
    signIn: { available, reason },
    durationMs: Date.now() - started,
  });
  try {
    oauth = mayUseOAuth(spec) ? await OAuthSession.start(spec.url!, { openBrowser, interactive: signIn }) : undefined;
    let remote: StreamableHTTPClientTransport | SSEClientTransport | undefined;
    const connectOpts: ConnectOptions = { onStderr, authProvider: oauth?.provider, onRemote: (t) => (remote = t) };
    try {
      transport = await withTimeout(connect(spec, client, connectOpts), timeoutMs);
    } catch (e) {
      if (!(e instanceof UnauthorizedError) || !oauth?.awaitingSignIn || !remote) throw e;
      // The server wants OAuth and Kumi could sign in. Without `signIn`, stop here: the server is up.
      if (!signIn) return reachable(true);
      // The browser is open on its sign-in page: wait for the redirect, then retry.
      const code = await oauth.waitForCode(SIGN_IN_TIMEOUT_MS);
      await remote.finishAuth(code);
      await remote.close().catch(() => {});
      await client.close().catch(() => {});
      client = new Client({ name: 'kumi', version: '0.1.0' });
      transport = await withTimeout(connect(spec, client, connectOpts), timeoutMs);
    }
    const info = client.getServerVersion();
    const tools = await withTimeout(client.listTools(), 30_000).catch(() => ({ tools: [] }));
    return {
      ok: true,
      serverName: info?.name,
      serverVersion: info?.version,
      tools: tools.tools.map((t) => ({ name: t.name, description: t.description })),
      stderr: fullStderr.slice(-STDERR_SHOWN) || undefined,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    // The server asked for OAuth and has an authorization server, but Kumi couldn't get a client (registration
    // refused, or none offered). The server works; the user's apps sign in with their own clients.
    if (!signIn && oauth?.signInStarted && oauth.authServerMetadata) {
      const reason = signInUnavailableReason(oauth);
      const cause = e instanceof Error ? e.message : String(e);
      await log('info', 'test-connection', `"${spec.name}" is up, but Kumi can't sign in to it: ${reason}`, `${describeForLog(spec)}\ncause: ${cause}`);
      return reachable(false, reason);
    }
    let message = e instanceof Error ? e.message : String(e);
    // It asked for credentials but has no OAuth metadata, so the SDK's error (from guessing at a registration URL) misleads.
    if (oauth?.signInStarted && !oauth.authServerMetadata) message = 'The server answered 401 Unauthorized and offers no OAuth sign-in';
    // HTTP transport errors carry the status in `code`, and the message is often just the (empty) body.
    const status = (e as { code?: unknown } | null)?.code;
    if (typeof status === 'number' && status >= 400 && !message.includes(String(status))) message = `${message.replace(/:\s*$/, '')} (HTTP ${status})`;
    let unreachable: HealthResult['unreachable'];
    let address: string | undefined;
    // No HTTP answer from a remote server: say why the connection failed instead of "fetch failed".
    if (spec.transport !== 'stdio' && typeof status !== 'number' && !(e instanceof UnauthorizedError)) {
      const host = hostOf(spec.url) ?? new URL(spec.url!).hostname;
      const found = await diagnose(spec, e);
      address = found.address;
      const words = found.cause && describeCause(found.cause, host, codedError(e));
      if (words) message = words;
      if (isUnreachable(found.cause)) unreachable = { cause: found.cause, host };
    }
    // A package that couldn't be downloaded: say why, from the package manager's output.
    let download = downloadFailure(spec, fullStderr);
    if (!download && spec.transport === 'stdio' && /^Timed out after/.test(message)) {
      const probed = await probeRegistry(spec);
      download = probed.download;
      address = probed.address;
    }
    if (download) {
      message = describeDownload(download, spec, message);
      if (download.cause === 'network' && isUnreachable(download.network) && download.host) unreachable = { cause: download.network, host: download.host };
    }
    const privateNetwork = privateNetworkOf(spec, opts, address, download?.host);
    // The download's own words already say what to do; the generic hints would misread a registry's 401.
    const error = download ? message : hint(message, fullStderr);
    const durationMs = Date.now() - started;
    const stack = e instanceof Error && e.stack ? `\n${e.stack}` : '';
    await log(
      unreachable ? 'warn' : 'error',
      'test-connection',
      `"${spec.name}" failed after ${(durationMs / 1000).toFixed(1)}s: ${error}`,
      `${describeForLog(spec)}${privateNetwork ? `\nprivate network: ${privateNetwork.source}${privateNetwork.pattern ? ` (${privateNetwork.pattern})` : ''}` : ''}${stack}${fullStderr ? `\nstderr:\n${fullStderr}` : ''}`,
    );
    return {
      ok: false,
      tools: [],
      error,
      stderr: fullStderr.slice(-STDERR_SHOWN) || undefined,
      durationMs,
      ...(unreachable ? { unreachable } : {}),
      ...(privateNetwork ? { privateNetwork } : {}),
      ...(download ? { download } : {}),
    };
  } finally {
    oauth?.close();
    await client.close().catch(() => {});
    await transport?.close().catch(() => {});
  }
}
