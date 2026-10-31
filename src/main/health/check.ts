// "Test connection": start the server (or connect to it), do the MCP handshake and list its tools.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { HealthResult, ServerSpec } from '@shared/types';

const TIMEOUT_MS = 90_000; // first `npx`/`uvx`/`docker` run may download the package

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

async function connect(spec: ServerSpec, client: Client, onStderr: (chunk: string) => void): Promise<Transport> {
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
      const transport = new StreamableHTTPClientTransport(url, { requestInit });
      await client.connect(transport);
      return transport;
    } catch (e) {
      // Some servers still only speak the older SSE transport.
      if (!/\b(404|405)\b/.test(String(e))) throw e;
    }
  }
  const transport = new SSEClientTransport(url, { requestInit });
  await client.connect(transport);
  return transport;
}

export async function testServer(spec: ServerSpec): Promise<HealthResult> {
  const started = Date.now();
  let stderr = '';
  const client = new Client({ name: 'kumi', version: '0.1.0' });
  let transport: Transport | undefined;
  try {
    transport = await withTimeout(connect(spec, client, (c) => (stderr = (stderr + c).slice(-4000))), TIMEOUT_MS);
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
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, tools: [], error: hint(message, stderr), stderr: stderr || undefined, durationMs: Date.now() - started };
  } finally {
    await client.close().catch(() => {});
    await transport?.close().catch(() => {});
  }
}
