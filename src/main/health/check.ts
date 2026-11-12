// "Test connection": start the server (or connect to it), do the MCP handshake and list its tools.

import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { HealthResult, ServerSpec } from '@shared/types';
import { OAuthSession, type OpenBrowser } from './oauth';

const TIMEOUT_MS = 90_000; // first `npx`/`uvx`/`docker` run may download the package
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

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

export async function testServer(spec: ServerSpec, openBrowser: OpenBrowser = openInBrowser): Promise<HealthResult> {
  const started = Date.now();
  let stderr = '';
  const onStderr = (c: string) => (stderr = (stderr + c).slice(-4000));
  let client = new Client({ name: 'kumi', version: '0.1.0' });
  let transport: Transport | undefined;
  let oauth: OAuthSession | undefined;
  try {
    oauth = mayUseOAuth(spec) ? await OAuthSession.start(spec.url!, openBrowser) : undefined;
    let remote: StreamableHTTPClientTransport | SSEClientTransport | undefined;
    const opts: ConnectOptions = { onStderr, authProvider: oauth?.provider, onRemote: (t) => (remote = t) };
    try {
      transport = await withTimeout(connect(spec, client, opts), TIMEOUT_MS);
    } catch (e) {
      // The server wants OAuth and the browser is open on its sign-in page: wait for the redirect, then retry.
      if (!(e instanceof UnauthorizedError) || !oauth?.awaitingSignIn || !remote) throw e;
      const code = await oauth.waitForCode(SIGN_IN_TIMEOUT_MS);
      await remote.finishAuth(code);
      await remote.close().catch(() => {});
      await client.close().catch(() => {});
      client = new Client({ name: 'kumi', version: '0.1.0' });
      transport = await withTimeout(connect(spec, client, opts), TIMEOUT_MS);
    }
    const info = client.getServerVersion();
    const tools = await withTimeout(client.listTools(), 30_000).catch(() => ({ tools: [] }));
    return {
      ok: true,
      serverName: info?.name,
      serverVersion: info?.version,
      tools: tools.tools.map((t) => ({ name: t.name, description: t.description })),
      stderr: stderr || undefined,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e);
    // HTTP transport errors carry the status in `code`, and the message is often just the (empty) body.
    const status = (e as { code?: unknown } | null)?.code;
    if (typeof status === 'number' && status >= 400 && !message.includes(String(status))) message = `${message.replace(/:\s*$/, '')} (HTTP ${status})`;
    return { ok: false, tools: [], error: hint(message, stderr), stderr: stderr || undefined, durationMs: Date.now() - started };
  } finally {
    oauth?.close();
    await client.close().catch(() => {});
    await transport?.close().catch(() => {});
  }
}
